#!/usr/bin/env python3
"""Server-side IPython kernel bridge (US-197).

Spawned by the Node-side kernel manager (`src/lib/server/kernelManager.ts`)
once per lesson session. It owns a single real IPython kernel via
`jupyter_client.KernelManager` and exposes a tiny line-delimited JSON protocol
over stdin/stdout so the manager can drive `execute` / `interrupt` / `restart`
/ `shutdown` without speaking ZeroMQ from Node.

Why a Python bridge instead of talking ZMQ from Node: jupyter_client is the
blessed, version-stable way to start/stop/interrupt a kernel and to frame
Jupyter messages. Mirroring the `claude -p` / whisper.cpp discipline, the Node
side spawns this as a child process, pipes JSON in, reads JSON out, and
force-kills the *process group* on timeout (the manager launches us with
`detached: true`, and the kernel is our child, so a group SIGKILL reaps both).

Protocol (one JSON object per line):
  Node -> bridge:
    {"type":"execute","id":<n>,"code":"...","timeoutMs":<n?>}
    {"type":"interrupt"}
    {"type":"restart","id":<n>}
    {"type":"shutdown","id":<n>}
  bridge -> Node:
    {"type":"ready"}                                  # kernel up, channels ready
    {"type":"fatal","error":"..."}                    # startup failed (exit 1)
    {"type":"execute_reply","id":<n>,"status":"ok"|"error"|"abort",
       "stdout":"...","stderr":"...","result":<str|null>,
       "error":{"ename":...,"evalue":...,"traceback":[...]}|null}
    {"type":"restart_reply","id":<n>}
    {"type":"shutdown_reply","id":<n>}

The kernel is launched from THIS interpreter's `ipykernel_launcher` (we set the
KernelManager's kernel_spec argv to `[sys.executable, -m, ipykernel_launcher,
-f, {connection_file}]`) so we never depend on a registered "python3"
kernelspec — whichever venv runs the bridge is exactly the venv the kernel
runs in. That keeps the US-196 runtime (torch/tf/cv2) and the kernel in lockstep.
"""

import json
import os
import queue
import sys
import threading

try:
    from jupyter_client.manager import KernelManager
    from jupyter_client.kernelspec import KernelSpec
except Exception as exc:  # pragma: no cover - exercised only without runtime
    sys.stdout.write(
        json.dumps({"type": "fatal", "error": f"import jupyter_client failed: {exc}"})
        + "\n"
    )
    sys.stdout.flush()
    sys.exit(1)


def emit(obj):
    """Write one JSON line to stdout and flush so Node sees it immediately."""
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def make_kernel_manager():
    km = KernelManager()
    # Force the kernel to run under *this* interpreter rather than whatever the
    # ambient "python3" kernelspec resolves to. This is the whole point of the
    # bridge: kernel venv == bridge venv == US-196 runtime.
    km._kernel_spec = KernelSpec(
        argv=[sys.executable, "-m", "ipykernel_launcher", "-f", "{connection_file}"],
        display_name="ai-lecturer-kernel",
        language="python",
    )
    return km


def drain_iopub(kc, msg_id, ready_timeout):
    """Pump the iopub channel for `msg_id` until the kernel returns to idle.

    Returns (stdout, stderr, result, error, images). `error` is None on success
    or a dict {ename, evalue, traceback}. `images` is a list of base64 PNG
    strings captured from `display_data` / `execute_result` (US-201 inline
    image output). We rely on the terminal `status: idle` message (whose parent
    is our execute request) to know the cell finished — this is the canonical
    Jupyter completion signal and works for code that produces no output at all.
    """
    stdout_parts = []
    stderr_parts = []
    result = None
    error = None
    images = []
    while True:
        try:
            msg = kc.get_iopub_msg(timeout=ready_timeout)
        except queue.Empty:
            # No traffic within the window. The Node side enforces the real
            # execution timeout (and force-kills us), so just keep waiting.
            continue
        if msg.get("parent_header", {}).get("msg_id") != msg_id:
            continue
        mtype = msg["header"]["msg_type"]
        content = msg["content"]
        if mtype == "stream":
            if content.get("name") == "stderr":
                stderr_parts.append(content.get("text", ""))
            else:
                stdout_parts.append(content.get("text", ""))
        elif mtype in ("execute_result", "display_data"):
            data = content.get("data", {})
            # iopub already carries image/png as a base64 string.
            png = data.get("image/png")
            if png:
                images.append(png)
            if "text/plain" in data:
                result = data["text/plain"]
        elif mtype == "error":
            error = {
                "ename": content.get("ename", ""),
                "evalue": content.get("evalue", ""),
                "traceback": content.get("traceback", []),
            }
        elif mtype == "status" and content.get("execution_state") == "idle":
            break
    return "".join(stdout_parts), "".join(stderr_parts), result, error, images


def run_execute(kc, cmd):
    code = cmd.get("code", "")
    msg_id = kc.execute(code, store_history=False, allow_stdin=False)
    stdout, stderr, result, error, images = drain_iopub(kc, msg_id, ready_timeout=1.0)
    emit(
        {
            "type": "execute_reply",
            "id": cmd.get("id"),
            "status": "error" if error else "ok",
            "stdout": stdout,
            "stderr": stderr,
            "result": result,
            "error": error,
            "images": images,
        }
    )


def run_reset(kc, cmd):
    """Clear the kernel's user namespace in place (no restart). Mirrors the
    Pyodide `resetNamespace` path: names defined by previous cells are gone,
    but the kernel process (and its loaded libraries) stays warm."""
    msg_id = kc.execute("get_ipython().reset(new_session=False)", store_history=False, allow_stdin=False)
    drain_iopub(kc, msg_id, ready_timeout=1.0)
    emit({"type": "reset_reply", "id": cmd.get("id")})


def main():
    ready_timeout = float(os.environ.get("AI_LECTURER_KERNEL_READY_TIMEOUT", "60"))
    km = make_kernel_manager()
    try:
        km.start_kernel()
        kc = km.client()
        kc.start_channels()
        kc.wait_for_ready(timeout=ready_timeout)
    except Exception as exc:
        emit({"type": "fatal", "error": f"kernel start failed: {exc}"})
        try:
            km.shutdown_kernel(now=True)
        except Exception:
            pass
        sys.exit(1)

    emit({"type": "ready"})

    # A dedicated reader thread lets `interrupt` arrive *while* an execute is
    # blocking on iopub. execute/restart/shutdown are funnelled through a queue
    # so they run serialized on the main thread; interrupt is handled inline
    # because it must take effect mid-execution (KeyboardInterrupt the cell).
    work = queue.Queue()
    client_box = {"kc": kc}

    def reader():
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue
            ctype = cmd.get("type")
            if ctype == "interrupt":
                try:
                    km.interrupt_kernel()
                except Exception:
                    pass
            elif ctype in ("execute", "restart", "shutdown", "reset"):
                work.put(cmd)
        # stdin closed -> parent is gone; ask the loop to shut down.
        work.put({"type": "shutdown", "id": None, "_eof": True})

    threading.Thread(target=reader, daemon=True).start()

    while True:
        cmd = work.get()
        ctype = cmd["type"]
        if ctype == "shutdown":
            try:
                km.shutdown_kernel(now=True)
            except Exception:
                pass
            if not cmd.get("_eof"):
                emit({"type": "shutdown_reply", "id": cmd.get("id")})
            break
        if ctype == "restart":
            try:
                client_box["kc"].stop_channels()
            except Exception:
                pass
            km.restart_kernel(now=True)
            kc2 = km.client()
            kc2.start_channels()
            kc2.wait_for_ready(timeout=ready_timeout)
            client_box["kc"] = kc2
            emit({"type": "restart_reply", "id": cmd.get("id")})
            continue
        if ctype == "reset":
            run_reset(client_box["kc"], cmd)
            continue
        if ctype == "execute":
            run_execute(client_box["kc"], cmd)


if __name__ == "__main__":
    main()

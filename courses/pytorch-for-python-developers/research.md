# Research: PyTorch for Python Developers

## Topic summary

PyTorch is the dominant Python framework for building and training neural networks. For an engineer who already writes Python and uses NumPy, the conceptual leap is small: a `torch.Tensor` is a strided n-dimensional array — like `numpy.ndarray` — that additionally tracks an optional gradient and can live on either the CPU or a CUDA device. Two ideas distinguish PyTorch from "NumPy with a GPU": **autograd** (the framework records every operation on tensors with `requires_grad=True` into a dynamic computation graph that can be differentiated by calling `.backward()`), and **`nn.Module`** (an object-oriented container that registers submodules and parameters so an optimizer can iterate over them). Everything else — losses, optimizers, training loops — composes from those two primitives.

The course targets a learner who is comfortable with Python and NumPy at the intermediate level but new to deep-learning frameworks. The goal is **not** to teach machine-learning theory (loss landscapes, regularization, architecture design); it is to teach the framework itself end-to-end so the learner can read and modify a vanilla PyTorch training script. By the final lesson the learner should be able to write the canonical six-line training step (`zero_grad → forward → loss → backward → step → metric`) without copying it from a tutorial.

The duration target is `standard` (2 modules, 6 lessons, ~75 minutes total) and `theoryPracticeRatio` is 0.5 — every theory section should be paired with either a code exercise or a fill-in-the-blanks exercise. Per the course-spec clarifications, examples target **pure PyTorch** (no Lightning, no HuggingFace wrappers) with NumPy as the reference comparison, and **every runnable exercise must execute on CPU only** — GPU and CUDA are discussed conceptually so the learner recognises them in real-world code, but no exercise depends on `cuda` being available.

## Prerequisites

- Comfortable Python: functions, classes, list/dict comprehensions, basic decorators.
- NumPy at the level of `np.array`, `dtype`, broadcasting, slicing, `arr.shape` / `arr.reshape`, element-wise vs. matmul.
- Mental model of a function as something with inputs, outputs, and (informally) a derivative — calculus 101 chain rule, no measure theory.
- Pip / venv basics; able to install a package and read a stack trace.
- Not required: prior deep-learning experience, GPU access, or Jupyter.

## Key concepts

- **Tensor**: strided n-d array of a single dtype, living on a single device, possibly tracking gradients.
- **dtype**: numeric type of the tensor (`torch.float32`, `torch.int64`, …) — must match across operands or be explicitly cast.
- **Device**: where the tensor's storage lives (`'cpu'`, `'cuda:0'`, `'mps'`). Operations require all operands on the same device.
- **`requires_grad`**: per-leaf boolean that opts a tensor into the autograd graph. Default is `False`; set on inputs / parameters that need gradients.
- **Computation graph**: dynamic DAG of operations PyTorch records on the fly whenever `requires_grad=True` tensors flow through ops. Each forward pass builds a fresh graph.
- **`backward()`**: triggers reverse-mode automatic differentiation through the recorded graph and accumulates `.grad` on every leaf with `requires_grad=True`.
- **Leaf tensor**: a tensor created directly by the user (not the output of an op). Only leaves accumulate `.grad`.
- **`.grad` accumulation**: `.grad` is *added to*, never replaced — the reason `optimizer.zero_grad()` exists.
- **`nn.Module`**: base class for models. Registers `nn.Parameter` and child `nn.Module` instances assigned as attributes so `.parameters()` can yield them and an optimizer can update them.
- **`nn.Parameter`**: a `Tensor` subclass with `requires_grad=True` by default; what `nn.Module` recognises as "trainable".
- **Forward pass**: `model(x)` calls `model.__call__(x)` which dispatches to `model.forward(x)` after running module hooks. **Never** call `model.forward(x)` directly.
- **Loss function**: a callable that takes `(prediction, target)` and returns a scalar tensor — the only kind of tensor `.backward()` accepts without an explicit `gradient=` argument.
- **Optimizer**: an object holding a reference to `model.parameters()` plus state (e.g. SGD momentum buffers, Adam running moments). `.step()` applies the update; `.zero_grad()` clears `.grad` between iterations.
- **Training step**: the canonical sequence `optim.zero_grad() → out = model(x) → loss = loss_fn(out, y) → loss.backward() → optim.step()`. Memorise this shape.
- **Train vs. eval mode**: `model.train()` / `model.eval()` toggle layers like Dropout and BatchNorm. Pure inference should also be wrapped in `with torch.no_grad():` to skip graph construction.

## Common misconceptions

- **"PyTorch is just NumPy with a GPU"** — Autograd, not GPU support, is the load-bearing feature. NumPy with a GPU is CuPy.
- **"`torch.Tensor` and `numpy.ndarray` share memory automatically"** — Only when you use `torch.from_numpy()` / `.numpy()` *and* the tensor is on the CPU and contiguous. A CUDA tensor cannot share memory with a NumPy array.
- **"Setting `requires_grad=True` on the input tensor of a model is what makes training work"** — No. Model parameters (`nn.Parameter` instances inside `nn.Module`) already have `requires_grad=True`. The input is a leaf with `requires_grad=False` in normal training; only adversarial-input use cases set it True on inputs.
- **"`.backward()` resets gradients before computing them"** — It accumulates. That is why every training loop calls `optimizer.zero_grad()` *before* the forward pass (or `set_to_none=True` for a faster reset).
- **"You can call `loss.backward()` twice on the same graph"** — By default the graph is freed after one backward. Use `retain_graph=True` only when you understand why you need it.
- **"`model.eval()` disables gradient computation"** — It does not. It only flips layers like Dropout and BatchNorm to eval mode. Use `with torch.no_grad():` (or `torch.inference_mode()`) to skip graph construction.
- **"Calling `model.forward(x)` is the same as `model(x)`"** — `model(x)` runs `__call__` which fires forward/backward hooks and is what you should always use; calling `forward` directly silently breaks anything that relies on those hooks.
- **"`tensor.to('cuda')` moves the tensor in place"** — `.to()` returns a new tensor on the target device. Bind the result: `x = x.to(device)`. The same is true for `.float()`, `.cpu()`, etc.
- **"You can mix CPU and GPU tensors in one operation"** — No. PyTorch raises `RuntimeError: Expected all tensors to be on the same device`. Both the model and the inputs must live on the same device.
- **"Optimizers know which parameters to update by inspecting the model"** — They know because *you pass `model.parameters()` into the optimizer constructor*. If you assign a layer to `self` after construction, you must rebuild the optimizer.

## Suggested ordering

1. **Tensors vs NumPy Arrays** — start where the learner already lives. Anchor the new mental model on `numpy.ndarray`. Establish dtype / shape / device vocabulary that every subsequent lesson re-uses.
2. **Autograd basics** — the one feature that makes PyTorch *not* NumPy. Introduce `requires_grad`, build a tiny graph by hand, call `.backward()`, inspect `.grad`. No model yet — keep the moving parts to `x`, `y`, and a one-line scalar function.
3. **Devices: CPU, CUDA, and Tensor Placement** — finish Module 1 with the CPU/CUDA distinction. Treated *conceptually* (the learner's machine may be CPU-only); the practical takeaway is "operations require both operands on the same device, write code that works in either world via `device = 'cuda' if torch.cuda.is_available() else 'cpu'`".
4. **Defining a Model with `nn.Module`** — open Module 2 with a small MLP. The learner has tensors and gradients; now they need a container that owns parameters and exposes `.parameters()`. Smallest useful example: 2 linear layers + ReLU.
5. **Loss Functions and Optimizers** — equip the model: pick an MSE / CrossEntropy loss, construct SGD or Adam, explain `zero_grad` / `step` and what state the optimizer holds.
6. **A Full Training Step End-to-End** — assemble the canonical six-line iteration, then run it for a handful of steps on a tiny synthetic dataset and watch the loss drop. Closes the loop opened in lesson 1.

## Notes for lesson generation

Targeting `theoryPracticeRatio = 0.5` — every Theory section should pair with either a `code` (graded) or `codeCloze` (fill-in-the-blank) section. Quizzes are checks-for-understanding, not assessments — keep one per lesson at most. Per the course-spec clarifications, all runnable code must work CPU-only with **pure PyTorch** (no Lightning / HuggingFace wrappers) and NumPy as the reference comparison.

- **Math / KaTeX**: useful in lesson 2 (autograd) — show the chain rule as `∂L/∂x = ∂L/∂y · ∂y/∂x` to anchor what `.backward()` is doing under the hood, and in lesson 5 (losses) for the MSE / CE formulas. Keep it minimal — block-math in one place per lesson, inline math elsewhere. Lessons 1, 3, 4 don't need any math.
- **Code exercise (graded) > quiz**:
  - Lesson 1: "convert this NumPy array to a tensor and back; assert dtype and shape".
  - Lesson 2: "create `x = torch.tensor(2.0, requires_grad=True)`, define `y = x ** 3`, call `.backward()`, and return `x.grad` — should be 12.0".
  - Lesson 4: "complete an `MLP(nn.Module)` with two linear layers and a ReLU; call `model(torch.randn(1, in_dim))` and assert the output shape".
  - Lesson 5: "given a model and a batch, compute MSE loss, backward, and SGD-step; assert the parameters changed".
  - Lesson 6: "fill in the missing `optim.zero_grad()` / `loss.backward()` / `optim.step()` lines and run for 50 iterations; final loss should be < 0.05".
- **CodeCloze > Code** when the goal is recognising the canonical shape of the API, not authoring it from scratch — lessons 3 (`x.to(device)`) and 6 (the training step) benefit from `codeCloze` because the learner is internalising idioms rather than designing logic.
- **Demo widget**: skip. The only registered demoType is `gauss` (Gaussian-blur image demo) which is unrelated to PyTorch. Do not invent new demoTypes — the registry rejects them.
- **Sandbox**: useful as the closer for lessons 2, 4, 5, and 6 — invite the learner to tweak `requires_grad`, swap a loss, change the learning rate, or add a third linear layer and watch what happens. Sandbox has no grading gate so it is the right widget for "play with it".
- **PlotImage / Histogram**: only if the figure carries information the learner cannot eyeball from code — e.g. a loss-curve PlotImage in lesson 6 ("Figure 1. Training loss over 50 iterations on the synthetic regression task"). Otherwise skip — text + code does the job.
- **DataTable**: a single small DataTable in lesson 5 comparing common loss functions (`MSELoss`, `L1Loss`, `CrossEntropyLoss`, `BCEWithLogitsLoss`) by use case is high-value reference material. Optimizer comparison (`SGD`, `Adam`, `AdamW`) is similarly compact.
- **DragMatch**: optional — useful in lesson 1 (term ↔ definition: dtype, device, shape, stride) or lesson 5 (loss ↔ task: regression / multi-class / binary-classification).
- **Video**: skip unless an Andrej Karpathy or 3Blue1Brown clip would meaningfully replace prose. Don't pad lessons with videos.
- **Quiz distractors**: pull from the *Common misconceptions* list above. The right answer per question should also map back to a specific concept the lesson just introduced.
- **Per-lesson sources**: copy ≥ 3 entries from the matching `## <lesson title>` heading in `sources.md` into the lesson's `sources` field. Course-wide references in `sources.md` are fair game for any lesson.
- **Slug conventions**: every lesson slug in `course.json` derives from the title via the webapp's `slugify()` (lowercase, `_`/whitespace → `-`, strip non `[a-z0-9-]`, collapse `-`). The slug "autograd-basics-requires-grad-and-backward" *intentionally* drops the underscore from `requires_grad`; do not try to preserve it.

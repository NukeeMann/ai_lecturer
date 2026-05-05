# Sources: PyTorch for Python Developers

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [PyTorch Documentation (stable)](https://pytorch.org/docs/stable/index.html) — kind: article; the official reference for every `torch.*` and `torch.nn.*` symbol used in this course. Cite the relevant sub-page from any lesson.
- [PyTorch Tutorials — Learn the Basics](https://pytorch.org/tutorials/beginner/basics/intro.html) — kind: article; the official entry-level tutorial sequence. Each lesson in this course parallels one or two tutorial pages.
- [Deep Learning with PyTorch](https://www.manning.com/books/deep-learning-with-pytorch) — kind: book; author: Eli Stevens, Luca Antiga, Thomas Viehmann; year: 2020; the canonical book introduction (Manning published a free PDF — link points to the publisher landing page; the freely-available copy is at https://www.manning.com/books/deep-learning-with-pytorch).
- [PyTorch: An Imperative Style, High-Performance Deep Learning Library](https://arxiv.org/abs/1912.01703) — kind: paper; author: Adam Paszke et al.; year: 2019; the NeurIPS paper describing PyTorch's design rationale (eager execution, autograd, `nn.Module`).
- [Deep Learning](https://www.deeplearningbook.org/) — kind: book; author: Ian Goodfellow, Yoshua Bengio, Aaron Courville; year: 2016; framework-agnostic theory backbone — cite chapters on backpropagation, MLPs, and SGD when extra theoretical grounding is useful.

## Tensors vs NumPy Arrays

- [PyTorch Tutorial — Tensors](https://pytorch.org/tutorials/beginner/basics/tensorqs_tutorial.html) — kind: article; the official "Learn the Basics" page on tensors, including NumPy bridging via `torch.from_numpy` and `.numpy()`. Stable.
- [torch.Tensor — PyTorch documentation](https://pytorch.org/docs/stable/tensors.html) — kind: article; reference page covering attributes (`dtype`, `device`, `shape`, `requires_grad`) and the full method surface.
- [torch.from_numpy — PyTorch documentation](https://pytorch.org/docs/stable/generated/torch.from_numpy.html) — kind: article; the canonical NumPy-to-tensor bridge with the memory-sharing semantics spelled out.
- [NumPy: the absolute basics for beginners](https://numpy.org/doc/stable/user/absolute_beginners.html) — kind: article; the official NumPy primer on `ndarray`, `dtype`, and shape — anchor for the comparison.

## Autograd Basics: requires_grad and backward()

- [PyTorch Tutorial — Automatic Differentiation with `torch.autograd`](https://pytorch.org/tutorials/beginner/basics/autogradqs_tutorial.html) — kind: article; official walkthrough of `requires_grad`, `.backward()`, and inspecting `.grad`. The teaching example in this course mirrors its structure.
- [Autograd mechanics — PyTorch documentation](https://pytorch.org/docs/stable/notes/autograd.html) — kind: article; the authoritative reference on how PyTorch builds and traverses the dynamic graph. Cite for the deeper "why" once the learner has the API.
- [Automatic differentiation in PyTorch](https://openreview.net/pdf?id=BJJsrmfCZ) — kind: paper; author: Adam Paszke et al.; year: 2017; the NeurIPS-Autodiff workshop paper that introduced PyTorch's autograd implementation.
- [CS231n — Backpropagation, Intuitions](https://cs231n.github.io/optimization-2/) — kind: article; Stanford's framework-free explanation of reverse-mode autodiff with worked examples — useful for the chain-rule intuition behind `.backward()`.

## Devices: CPU, CUDA, and Tensor Placement

- [torch.device — PyTorch documentation](https://pytorch.org/docs/stable/tensor_attributes.html#torch.device) — kind: article; reference page for the `device` type and the `'cpu'` / `'cuda:N'` string format every example uses.
- [CUDA semantics — PyTorch documentation](https://pytorch.org/docs/stable/notes/cuda.html) — kind: article; the official notes covering device contexts, asynchronous execution, and the `torch.cuda.is_available()` pattern this lesson teaches.
- [Tensor.to — PyTorch documentation](https://pytorch.org/docs/stable/generated/torch.Tensor.to.html) — kind: article; the canonical move-and-cast operation. Important for the misconception "is `.to()` in place?" (it is not).
- [CUDA C++ Programming Guide — Introduction](https://docs.nvidia.com/cuda/cuda-c-programming-guide/) — kind: article; NVIDIA's official one-page conceptual overview of what a GPU device is and why host/device memory is separate. Stable, vendor-canonical.

## Defining a Model with nn.Module

- [torch.nn.Module — PyTorch documentation](https://pytorch.org/docs/stable/generated/torch.nn.Module.html) — kind: article; the reference page for the base class — `__init__` / `forward` contract, `.parameters()`, `.children()`, train/eval modes.
- [PyTorch Tutorial — Build the Neural Network](https://pytorch.org/tutorials/beginner/basics/buildmodel_tutorial.html) — kind: article; official tutorial that builds a small image-classifier MLP — same shape as this lesson's exercise.
- [torch.nn.Linear — PyTorch documentation](https://pytorch.org/docs/stable/generated/torch.nn.Linear.html) — kind: article; the workhorse layer for the lesson's MLP, including the `(in_features, out_features)` signature.
- [Deep Learning, Chapter 6: Deep Feedforward Networks](https://www.deeplearningbook.org/contents/mlp.html) — kind: book; author: Ian Goodfellow, Yoshua Bengio, Aaron Courville; year: 2016; the framework-free theoretical backing for "what is an MLP".

## Loss Functions and Optimizers

- [Loss Functions — torch.nn documentation](https://pytorch.org/docs/stable/nn.html#loss-functions) — kind: article; the index of every built-in loss with mathematical definitions and tensor-shape contracts.
- [torch.optim — PyTorch documentation](https://pytorch.org/docs/stable/optim.html) — kind: article; reference for `SGD`, `Adam`, and the optimizer base contract (`step`, `zero_grad`, parameter groups).
- [PyTorch Tutorial — Optimizing Model Parameters](https://pytorch.org/tutorials/beginner/basics/optimization_tutorial.html) — kind: article; official tutorial that pairs a loss with an optimizer and walks through one training step — a natural template for this lesson.
- [Adam: A Method for Stochastic Optimization](https://arxiv.org/abs/1412.6980) — kind: paper; author: Diederik P. Kingma, Jimmy Ba; year: 2014; the original Adam paper — cite when introducing why Adam is a reasonable default beyond SGD.

## A Full Training Step End-to-End

- [PyTorch Tutorial — Optimizing Model Parameters](https://pytorch.org/tutorials/beginner/basics/optimization_tutorial.html) — kind: article; the official end-to-end optimization-loop walkthrough; the exercise in this lesson reproduces its structure on a tiny synthetic dataset.
- [PyTorch Tutorial — Training a Classifier (CIFAR-10)](https://pytorch.org/tutorials/beginner/blitz/cifar10_tutorial.html) — kind: article; the canonical "60-minute blitz" training script — concrete reference for the `zero_grad → forward → loss → backward → step` shape on real data.
- [torch.no_grad — PyTorch documentation](https://pytorch.org/docs/stable/generated/torch.no_grad.html) — kind: article; the reference for the inference context manager that should wrap evaluation passes.
- [3Blue1Brown — But what is a neural network?](https://www.youtube.com/watch?v=aircAruvnKk) — kind: video; author: Grant Sanderson; year: 2017; framework-free visual intuition for what the training loop is *doing* — useful as a closing reference for learners who want the picture rather than the API.

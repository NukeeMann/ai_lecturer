# Sources: Detekcja obiektów z YOLO — od mechaniki modelu do własnego detektora (Ultralytics YOLO11)

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.
>
> Headings below mirror `course-spec.draftStructure` lesson titles and are the
> anchors `generate_lesson` reads. If `design_course` renames a lesson, it must
> update the matching heading here.

## Course-wide references

- [Ultralytics YOLO Docs](https://docs.ultralytics.com/) — kind: article; the official documentation hub for YOLO11/YOLOv8 (tasks, modes, datasets, export). Primary reference for every practical lesson.
- [Ultralytics YOLO11 model documentation](https://docs.ultralytics.com/models/yolo11/) — kind: article; official YOLO11 overview: variants (n/s/m/l/x), architecture summary, benchmarks. The lead model of the course.
- [Ultralytics GitHub repository](https://github.com/ultralytics/ultralytics) — kind: article; the canonical source repo (issues, README, configs) backing the API the learner uses.
- [You Only Look Once: Unified, Real-Time Object Detection](https://doi.org/10.1109/CVPR.2016.91) — kind: paper; author: Joseph Redmon, Santosh Divvala, Ross Girshick, Ali Farhadi; year: 2016; the original YOLO paper — primary source for the "look once" idea (arXiv: https://arxiv.org/abs/1506.02640).
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; freely-available textbook with chapters on recognition and object detection for the theory framing.
- [DETRs Beat YOLOs on Real-time Object Detection (RT-DETR)](https://arxiv.org/abs/2304.08069) — kind: paper; author: Yian Zhao, Wenyu Lv, Shangliang Xu, Jinman Wei, Guanzhong Wang, Qingqing Dang, Yi Liu, Jie Chen; year: 2023; the RT-DETR primary source for the one optional comparison lesson.
- [Ultralytics RT-DETR documentation](https://docs.ultralytics.com/models/rtdetr/) — kind: article; official RT-DETR support page — the transformer-based, NMS-free contrast point to YOLO.

## Detekcja vs klasyfikacja vs segmentacja

- [Ultralytics — Tasks (Detect, Segment, Classify, Pose, OBB)](https://docs.ultralytics.com/tasks/) — kind: article; official overview that distinguishes the vision tasks and shows what each YOLO task returns.
- [Object detection — Wikipedia](https://en.wikipedia.org/wiki/Object_detection) — kind: article; stable definition of detection vs classification, terminology and history.
- [Microsoft COCO: Common Objects in Context](https://arxiv.org/abs/1405.0312) — kind: paper; author: Tsung-Yi Lin, Michael Maire, Serge Belongie, James Hays, Pietro Perona, Deva Ramanan, Piotr Dollár, C. Lawrence Zitnick; year: 2014; defines the benchmark that frames detection vs segmentation tasks and labels.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; recognition chapter contrasting classification, detection, and segmentation.

## Dlaczego YOLO „patrzy tylko raz”

- [You Only Look Once: Unified, Real-Time Object Detection](https://arxiv.org/abs/1506.02640) — kind: paper; author: Joseph Redmon, Santosh Divvala, Ross Girshick, Ali Farhadi; year: 2016; the source of the single-pass intuition — non-negotiable primary reference.
- [Faster R-CNN: Towards Real-Time Object Detection with Region Proposal Networks](https://arxiv.org/abs/1506.01497) — kind: paper; author: Shaoqing Ren, Kaiming He, Ross Girshick, Jian Sun; year: 2015; the two-stage detector YOLO is contrasted against (region proposals → classify).
- [Ultralytics — Object Detection task](https://docs.ultralytics.com/tasks/detect/) — kind: article; official framing of one-stage detection and what makes the YOLO inference loop fast.
- [Object detection — Wikipedia](https://en.wikipedia.org/wiki/Object_detection) — kind: article; one-stage vs two-stage taxonomy in stable summary form.

## Architektura: backbone → neck → head

- [Ultralytics YOLO11 model documentation](https://docs.ultralytics.com/models/yolo11/) — kind: article; official YOLO11 architecture summary (backbone, neck, head) and per-variant specs.
- [Feature Pyramid Networks for Object Detection](https://arxiv.org/abs/1612.03144) — kind: paper; author: Tsung-Yi Lin, Piotr Dollár, Ross Girshick, Kaiming He, Bharath Hariharan, Serge Belongie; year: 2017; the FPN top-down multi-scale fusion the YOLO neck builds on.
- [Path Aggregation Network for Instance Segmentation (PANet)](https://arxiv.org/abs/1803.01534) — kind: paper; author: Shu Liu, Lu Qi, Haifang Qin, Jianping Shi, Jiaya Jia; year: 2018; the bottom-up PAN path used in the YOLO neck.
- [Ultralytics — Model architecture reference (configs)](https://github.com/ultralytics/ultralytics/tree/main/ultralytics/cfg/models) — kind: article; the actual backbone/neck/head module definitions in YAML for the curious advanced learner.

## Od anchor-based do anchor-free i decoupled head

- [FCOS: Fully Convolutional One-Stage Object Detection](https://arxiv.org/abs/1904.01355) — kind: paper; author: Zhi Tian, Chunhua Shen, Hao Chen, Tong He; year: 2019; the canonical anchor-free, per-location detection formulation.
- [YOLOX: Exceeding YOLO Series in 2021](https://arxiv.org/abs/2107.08430) — kind: paper; author: Zheng Ge, Songtao Liu, Feng Wang, Zeming Li, Jian Sun; year: 2021; introduced the anchor-free + decoupled-head design that modern YOLO (v8/v11) adopts.
- [Ultralytics YOLOv8 model documentation](https://docs.ultralytics.com/models/yolov8/) — kind: article; official statement that YOLOv8/YOLO11 are anchor-free with a decoupled head, and why.
- [Ultralytics YOLO11 model documentation](https://docs.ultralytics.com/models/yolo11/) — kind: article; the head design used by the lead model of this course.

## INPUT: preprocessing obrazu

- [Ultralytics — Predict mode (inference & preprocessing)](https://docs.ultralytics.com/modes/predict/) — kind: article; official description of how images are loaded, resized, and batched before inference.
- [Ultralytics — Data augmentation guide (LetterBox & transforms)](https://docs.ultralytics.com/guides/yolo-data-augmentation/) — kind: article; official reference for the letterbox resize-with-padding and normalization transforms.
- [OpenCV — Geometric Transformations of Images (resize)](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html) — kind: article; official `cv2.resize` reference underpinning the preprocessing exercise.
- [You Only Look Once: Unified, Real-Time Object Detection](https://arxiv.org/abs/1506.02640) — kind: paper; author: Joseph Redmon, Santosh Divvala, Ross Girshick, Ali Farhadi; year: 2016; fixed-input-resolution rationale for resizing to a square grid.

## OUTPUT: od surowej siatki do finalnych detekcji

- [Ultralytics — Predict mode: working with Results](https://docs.ultralytics.com/modes/predict/#working-with-results) — kind: article; official reference for the decoded boxes/scores/classes object the model returns.
- [Non-maximum suppression (Object detection) — Wikipedia](https://en.wikipedia.org/wiki/Object_detection) — kind: article; stable explanation of NMS as the step that converts dense candidates into final boxes.
- [Soft-NMS — Improving Object Detection With One Line of Code](https://arxiv.org/abs/1704.04503) — kind: paper; author: Navaneeth Bodla, Bharat Singh, Rama Chellappa, Larry S. Davis; year: 2017; the canonical NMS-variant reference for the output-postprocessing lesson.
- [torchvision.ops.nms — PyTorch documentation](https://pytorch.org/vision/stable/generated/torchvision.ops.nms.html) — kind: article; official NMS implementation the learner can call/compare against their hand-written version.

## Funkcje straty i label assignment

- [Distance-IoU Loss: Faster and Better Learning for Bounding Box Regression (DIoU/CIoU)](https://arxiv.org/abs/1911.08287) — kind: paper; author: Zhaohui Zheng, Ping Wang, Wei Liu, Jinze Li, Rongguang Ye, Dongwei Ren; year: 2020; defines the CIoU box-regression loss used in YOLO.
- [Generalized Focal Loss: Learning Qualified and Distributed Bounding Boxes (DFL)](https://arxiv.org/abs/2006.04388) — kind: paper; author: Xiang Li, Wenhai Wang, Lijun Wu, Shuo Chen, Xiaolin Hu, Jun Li, Jinhui Tang, Jian Yang; year: 2020; the Distribution Focal Loss for box edges used by modern YOLO.
- [TOOD: Task-aligned One-stage Object Detection](https://arxiv.org/abs/2108.07755) — kind: paper; author: Chengjian Feng, Yujie Zhong, Yu Gao, Matthew R. Scott, Weilin Huang; year: 2021; the Task-Aligned Assigner (TAL) that decides which prediction learns which object.
- [Focal Loss for Dense Object Detection](https://arxiv.org/abs/1708.02002) — kind: paper; author: Tsung-Yi Lin, Priya Goyal, Ross Girshick, Kaiming He, Piotr Dollár; year: 2017; foundational classification-loss reference for dense one-stage detection.

## Format datasetu YOLO i data.yaml

- [Ultralytics — Detection datasets format](https://docs.ultralytics.com/datasets/detect/) — kind: article; the official spec: image/label layout, `.txt` row format, and `data.yaml` fields (`path`, `train`, `val`, `nc`, `names`).
- [Ultralytics — Datasets overview](https://docs.ultralytics.com/datasets/) — kind: article; official explanation of train/val/test splits and supported dataset structures.
- [The PASCAL Visual Object Classes (VOC) Challenge](https://doi.org/10.1007/s11263-009-0275-4) — kind: paper; author: Mark Everingham, Luc Van Gool, Christopher K. I. Williams, John Winn, Andrew Zisserman; year: 2010; defines the VOC box convention the YOLO format is contrasted with.
- [Microsoft COCO: Common Objects in Context](https://arxiv.org/abs/1405.0312) — kind: paper; author: Tsung-Yi Lin, Michael Maire, Serge Belongie, James Hays, Pietro Perona, Deva Ramanan, Piotr Dollár, C. Lawrence Zitnick; year: 2014; defines the COCO JSON annotation format converted into YOLO labels.

## Adnotacja i konwersja z COCO/Pascal VOC

- [Ultralytics — Converting annotation formats (COCO → YOLO)](https://docs.ultralytics.com/datasets/detect/coco/) — kind: article; official guidance/utilities for converting COCO annotations to YOLO label files.
- [ultralytics/JSON2YOLO — COCO/VOC to YOLO conversion tools](https://github.com/ultralytics/JSON2YOLO) — kind: article; the official conversion-script repository for moving COCO/VOC labels into YOLO format.
- [The PASCAL Visual Object Classes (VOC) Challenge](https://doi.org/10.1007/s11263-009-0275-4) — kind: paper; author: Mark Everingham, Luc Van Gool, Christopher K. I. Williams, John Winn, Andrew Zisserman; year: 2010; the VOC XML `xmin,ymin,xmax,ymax` convention to convert from.
- [Microsoft COCO: Common Objects in Context](https://arxiv.org/abs/1405.0312) — kind: paper; author: Tsung-Yi Lin, Michael Maire, Serge Belongie, James Hays, Pietro Perona, Deva Ramanan, Piotr Dollár, C. Lawrence Zitnick; year: 2014; the COCO JSON `x,y,w,h` (pixel) convention to convert from.

## Augmentacje typowe dla YOLO

- [Ultralytics — YOLO data augmentation guide](https://docs.ultralytics.com/guides/yolo-data-augmentation/) — kind: article; official catalogue of mosaic, mixup, copy-paste, HSV/geometric augmentations and the `close_mosaic` setting.
- [YOLOv4: Optimal Speed and Accuracy of Object Detection](https://arxiv.org/abs/2004.10934) — kind: paper; author: Alexey Bochkovskiy, Chien-Yao Wang, Hong-Yuan Mark Liao; year: 2020; introduced Mosaic augmentation in the YOLO line.
- [mixup: Beyond Empirical Risk Minimization](https://arxiv.org/abs/1710.09412) — kind: paper; author: Hongyi Zhang, Moustapha Cisse, Yann N. Dauphin, David Lopez-Paz; year: 2018; the original MixUp augmentation.
- [Simple Copy-Paste is a Strong Data Augmentation Method for Instance Segmentation](https://arxiv.org/abs/2012.07177) — kind: paper; author: Golnaz Ghiasi, Yin Cui, Aravind Srinivas, Rui Qian, Tsung-Yi Lin, Ekin D. Cubuk, Quoc V. Le, Barret Zoph; year: 2021; the Copy-Paste augmentation reference.

## Trening własnego detektora na lokalnym GPU

- [Ultralytics — Train mode](https://docs.ultralytics.com/modes/train/) — kind: article; official training reference: `model.train(...)`, epochs, batch, device, schedule, and all training arguments.
- [Ultralytics — Configuration / training settings](https://docs.ultralytics.com/usage/cfg/) — kind: article; the full hyperparameter list (lr0, warmup, momentum, weight decay, augmentation toggles) for tuning a local run.
- [Ultralytics — Hyperparameter tuning guide](https://docs.ultralytics.com/guides/hyperparameter-tuning/) — kind: article; official guidance on choosing/searching hyperparameters for a custom dataset.
- [Ultralytics — Transfer learning & training tips](https://docs.ultralytics.com/guides/model-training-tips/) — kind: article; fine-tuning from COCO-pretrained weights on a small dataset — the recommended fast path.

## Metryki i czytanie krzywych uczenia

- [Ultralytics — YOLO performance metrics guide](https://docs.ultralytics.com/guides/yolo-performance-metrics/) — kind: article; official explanation of precision, recall, mAP@0.5, mAP@0.5:0.95, PR curves, and how to read `results.png`.
- [Ultralytics — Validation (Val) mode](https://docs.ultralytics.com/modes/val/) — kind: article; how validation computes and reports the metrics the learner interprets.
- [Precision and recall — Wikipedia](https://en.wikipedia.org/wiki/Precision_and_recall) — kind: article; stable definitions of precision/recall and the precision-recall curve.
- [Microsoft COCO: Common Objects in Context](https://arxiv.org/abs/1405.0312) — kind: paper; author: Tsung-Yi Lin, Michael Maire, Serge Belongie, James Hays, Pietro Perona, Deva Ramanan, Piotr Dollár, C. Lawrence Zitnick; year: 2014; defines the COCO mAP@0.5:0.95 evaluation protocol.

## Inference i eksport modelu

- [Ultralytics — Export mode (ONNX, TensorRT, …)](https://docs.ultralytics.com/modes/export/) — kind: article; official reference for exporting a trained model to ONNX/TensorRT and the supported formats.
- [Ultralytics — Predict mode (inference on images/video)](https://docs.ultralytics.com/modes/predict/) — kind: article; official inference API for running the trained detector on images.
- [ONNX — Open Neural Network Exchange (documentation)](https://onnx.ai/onnx/) — kind: article; the official ONNX format/runtime reference for the exported model.
- [NVIDIA TensorRT documentation](https://docs.nvidia.com/deeplearning/tensorrt/latest/index.html) — kind: article; official TensorRT docs for the optimized-inference export target.

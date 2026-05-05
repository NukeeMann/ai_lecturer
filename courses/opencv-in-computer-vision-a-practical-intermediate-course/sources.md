# Sources: OpenCV in Computer Vision: A Practical Intermediate Course

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [OpenCV documentation — OpenCV 4.x tutorials](https://docs.opencv.org/4.x/d9/df8/tutorial_root.html) — kind: article; the official tutorial root, organised by module — anchor reference for every lesson that calls a `cv2.*` function.
- [OpenCV Python API reference](https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html) — kind: article; canonical Python-binding tutorial index used across the whole course.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; freely-available textbook covering filtering, features, geometry, motion, and recognition — chapter-aligned with the course's module order.
- [Digital Image Processing, 4th ed.](https://www.pearson.com/en-us/subject-catalog/p/digital-image-processing/P200000003224) — kind: book; author: Rafael C. Gonzalez and Richard E. Woods; year: 2018; canonical textbook for filtering, morphology, edges, histograms, and Fourier-domain ops.
- [OpenCV: Open Source Computer Vision Library — Bradski 2000](https://www.drdobbs.com/open-source/the-opencv-library/184404319) — kind: article; author: Gary Bradski; year: 2000; the original Dr. Dobb's announcement of OpenCV; useful one-liner of historical context.
- [Multiple View Geometry in Computer Vision, 2nd ed.](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; primary reference for homography, RANSAC, and camera calibration.

## Course Orientation and Environment Setup

- [OpenCV-Python — Install OpenCV-Python in your environment](https://docs.opencv.org/4.x/d2/de6/tutorial_py_setup_in_ubuntu.html) — kind: article; official cross-platform install guide — covers Linux, macOS, and Windows.
- [opencv-python on PyPI](https://pypi.org/project/opencv-python/) — kind: article; the canonical pip package; documents the variants (`opencv-python`, `opencv-contrib-python`) and version-pinning advice.
- [Python venv — Creation of virtual environments](https://docs.python.org/3/library/venv.html) — kind: article; official Python docs for the recommended isolation approach.
- [NumPy quickstart](https://numpy.org/doc/stable/user/quickstart.html) — kind: article; refresher on `ndarray`, dtypes, slicing, broadcasting — the prerequisite the orientation lesson explicitly checks.

## How Computers See: Pixels, Channels, and Color Spaces

- [OpenCV — Changing Colorspaces](https://docs.opencv.org/4.x/df/d9d/tutorial_py_colorspaces.html) — kind: article; official tutorial covering BGR↔Gray↔HSV transformations.
- [HSL and HSV — Wikipedia](https://en.wikipedia.org/wiki/HSL_and_HSV) — kind: article; canonical definition of the HSV cone with formulas for the conversion.
- [Why does OpenCV use BGR color order? — OpenCV blog](https://learnopencv.com/why-does-opencv-use-bgr-color-format/) — kind: article; first-party historical note from the OpenCV team explaining the BGR convention.
- [NumPy array fundamentals (`ndarray`, dtypes, axis)](https://numpy.org/doc/stable/user/basics.html) — kind: article; reference for the `H×W×C uint8` array model.

## Reading, Displaying, and Writing Images

- [OpenCV — Getting Started with Images](https://docs.opencv.org/4.x/db/deb/tutorial_display_image.html) — kind: article; official tutorial for `imread` / `imshow` / `imwrite`.
- [`cv2.imread` — OpenCV Python reference](https://docs.opencv.org/4.x/d4/da8/group__imgcodecs.html#ga288b8b3da0892bd651fce07b3bbd3a56) — kind: article; canonical API reference for the read flag (`IMREAD_COLOR` vs `IMREAD_UNCHANGED` etc.).
- [Pillow Handbook — Image file formats](https://pillow.readthedocs.io/en/stable/handbook/image-file-formats.html) — kind: article; concise reference on JPEG/PNG/TIFF behaviour for cross-checking when `imread` returns `None`.

## Drawing and Annotating Images

- [OpenCV — Drawing Functions in OpenCV](https://docs.opencv.org/4.x/dc/da5/tutorial_py_drawing_functions.html) — kind: article; official walkthrough of `line`, `rectangle`, `circle`, `polylines`, `putText`.
- [OpenCV `putText` API reference](https://docs.opencv.org/4.x/d6/d6e/group__imgproc__draw.html#ga5126f47f883d730f633d74f07456c576) — kind: article; canonical reference for fonts, scale, thickness, and anti-aliasing flags.
- [Hershey fonts — Wikipedia](https://en.wikipedia.org/wiki/Hershey_fonts) — kind: article; background on the vector font family OpenCV ships and the `FONT_HERSHEY_*` constants.

## Image Arithmetic and Bitwise Operations

- [OpenCV — Arithmetic Operations on Images](https://docs.opencv.org/4.x/d0/d86/tutorial_py_image_arithmetics.html) — kind: article; official tutorial for `add`, `addWeighted`, `subtract`, and saturation arithmetic.
- [OpenCV — Bitwise Operations (Image Logo Compositing)](https://docs.opencv.org/4.x/d0/d86/tutorial_py_image_arithmetics.html#bitwise-operations) — kind: article; canonical example of mask-driven compositing with `bitwise_and/or/not`.
- [Alpha compositing — Wikipedia](https://en.wikipedia.org/wiki/Alpha_compositing) — kind: article; theoretical background on the linear-blend operation `addWeighted` implements.

## Geometric Transformations: Resize, Rotate, Translate

- [OpenCV — Geometric Transformations of Images](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html) — kind: article; official walkthrough of `resize`, `warpAffine`, `getRotationMatrix2D`.
- [Affine transformation — Wikipedia](https://en.wikipedia.org/wiki/Affine_transformation) — kind: article; primary definition of the 2×3 affine matrix and its degrees of freedom.
- [Image scaling — Wikipedia](https://en.wikipedia.org/wiki/Image_scaling) — kind: article; covers nearest-neighbour, bilinear, bicubic, and Lanczos interpolation — the choices behind `cv2.INTER_*` flags.

## Perspective Transforms and Image Warping

- [OpenCV — Perspective Transformation tutorial](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html#perspective-transformation) — kind: article; canonical worked example of `getPerspectiveTransform` + `warpPerspective`.
- [Homography — Wikipedia](https://en.wikipedia.org/wiki/Homography_(computer_vision)) — kind: article; planar projective mapping, four-point parameterisation, and the constraint that maps four image points to four world points.
- [Multiple View Geometry in Computer Vision, 2nd ed. — Ch. 4 (Estimation)](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; rigorous treatment of homography estimation that underlies the four-point trick.

## Smoothing and Blurring Filters

- [OpenCV — Smoothing Images](https://docs.opencv.org/4.x/d4/d13/tutorial_py_filtering.html) — kind: article; covers averaging, Gaussian, median, and bilateral filters with side-by-side outputs.
- [Gaussian blur — Wikipedia](https://en.wikipedia.org/wiki/Gaussian_blur) — kind: article; canonical reference for the 2D Gaussian kernel and the σ↔kernel-size relationship.
- [Tomasi, C. and Manduchi, R. — *Bilateral Filtering for Gray and Color Images* (1998)](https://doi.org/10.1109/ICCV.1998.710815) — kind: paper; author: Carlo Tomasi and Roberto Manduchi; year: 1998; original paper for the bilateral filter that `cv2.bilateralFilter` implements.
- [Median filter — Wikipedia](https://en.wikipedia.org/wiki/Median_filter) — kind: article; treatment of why median outperforms mean on impulse / salt-and-pepper noise.

## Thresholding Techniques

- [OpenCV — Image Thresholding](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html) — kind: article; official tutorial covering global, adaptive, and Otsu thresholding side-by-side.
- [Otsu, N. — *A Threshold Selection Method from Gray-Level Histograms* (1979)](https://doi.org/10.1109/TSMC.1979.4310076) — kind: paper; author: Nobuyuki Otsu; year: 1979; the original between-class-variance criterion that `cv2.THRESH_OTSU` implements.
- [Thresholding (image processing) — Wikipedia](https://en.wikipedia.org/wiki/Thresholding_(image_processing)) — kind: article; survey of global vs. local thresholding strategies.

## Morphological Operations

- [OpenCV — Morphological Transformations](https://docs.opencv.org/4.x/d9/d61/tutorial_py_morphological_ops.html) — kind: article; official walkthrough of erosion, dilation, opening, closing, gradient, top-hat.
- [Mathematical morphology — Wikipedia](https://en.wikipedia.org/wiki/Mathematical_morphology) — kind: article; set-theoretic foundation for the structuring-element model.
- [Serra, J. — *Image Analysis and Mathematical Morphology* (book listing)](https://www.elsevier.com/books/image-analysis-and-mathematical-morphology/serra/978-0-12-637240-3) — kind: book; author: Jean Serra; year: 1982; foundational textbook for binary morphology — cite for the rigorous definitions.

## Image Gradients with Sobel and Scharr

- [OpenCV — Image Gradients (Sobel, Scharr, Laplacian)](https://docs.opencv.org/4.x/d5/d0f/tutorial_py_gradients.html) — kind: article; official tutorial for `cv2.Sobel`, `cv2.Scharr`, and `cv2.Laplacian` with dtype caveats.
- [Sobel operator — Wikipedia](https://en.wikipedia.org/wiki/Sobel_operator) — kind: article; canonical entry covering Sobel, Scharr, and Prewitt with kernel matrices.
- [Scharr, H. — *Optimal Operators in Digital Image Processing* (2000)](https://archiv.ub.uni-heidelberg.de/volltextserver/962/) — kind: paper; author: Hanno Scharr; year: 2000; original derivation of the rotationally optimised Scharr kernel.
- [Image gradient — Wikipedia](https://en.wikipedia.org/wiki/Image_gradient) — kind: article; foundational definition of the discrete partial derivative pair `(I_x, I_y)`.

## Canny Edge Detection in Depth

- [Canny, J. — *A Computational Approach to Edge Detection* (1986)](https://doi.org/10.1109/TPAMI.1986.4767851) — kind: paper; author: John Canny; year: 1986; the original paper — non-negotiable primary source.
- [OpenCV — Canny Edge Detection tutorial](https://docs.opencv.org/4.x/da/d22/tutorial_py_canny.html) — kind: article; official tutorial with parameter-tuning intuition (`threshold1`, `threshold2`, `apertureSize`, `L2gradient`).
- [Canny edge detector — Wikipedia](https://en.wikipedia.org/wiki/Canny_edge_detector) — kind: article; readable summary of the four stages: blur → gradient → NMS → hysteresis.
- [Computerphile — Finding Edges (Canny)](https://www.youtube.com/watch?v=uihBwtPIBxM) — kind: video; clean visual walkthrough of NMS and double thresholding.

## Finding and Drawing Contours

- [OpenCV — Contours: Getting Started](https://docs.opencv.org/4.x/d4/d73/tutorial_py_contours_begin.html) — kind: article; official tutorial for `findContours` and `drawContours`.
- [OpenCV — Contour Hierarchy](https://docs.opencv.org/4.x/d9/d8b/tutorial_py_contours_hierarchy.html) — kind: article; explains the four hierarchy retrieval modes (`RETR_EXTERNAL`, `RETR_LIST`, `RETR_CCOMP`, `RETR_TREE`).
- [Suzuki, S. and Abe, K. — *Topological Structural Analysis of Digitized Binary Images by Border Following* (1985)](https://doi.org/10.1016/0734-189X(85)90016-7) — kind: paper; author: Satoshi Suzuki and Keiichi Abe; year: 1985; the algorithm `findContours` implements.

## Contour Properties and Shape Analysis

- [OpenCV — Contour Features](https://docs.opencv.org/4.x/dd/d49/tutorial_py_contour_features.html) — kind: article; official tutorial covering area, perimeter, bounding box, minimum enclosing circle, ellipse, convex hull.
- [OpenCV — Contour Properties](https://docs.opencv.org/4.x/d1/d32/tutorial_py_contour_properties.html) — kind: article; aspect ratio, extent, solidity, equivalent diameter — the practical shape-classification toolkit.
- [Hu, M. K. — *Visual Pattern Recognition by Moment Invariants* (1962)](https://doi.org/10.1109/TIT.1962.1057692) — kind: paper; author: Ming-Kuei Hu; year: 1962; original derivation of the seven Hu invariants exposed via `cv2.HuMoments`.
- [Image moment — Wikipedia](https://en.wikipedia.org/wiki/Image_moment) — kind: article; central, normalised, and Hu moments in one place.

## Histograms and Histogram Equalization

- [OpenCV — Histograms - 1: Find, Plot, Analyze](https://docs.opencv.org/4.x/d1/db7/tutorial_py_histogram_begins.html) — kind: article; official tutorial for `cv2.calcHist`.
- [OpenCV — Histogram Equalization](https://docs.opencv.org/4.x/d5/daf/tutorial_py_histogram_equalization.html) — kind: article; covers global equalisation and CLAHE side-by-side.
- [Zuiderveld, K. — *Contrast Limited Adaptive Histogram Equalization* (1994)](https://doi.org/10.1016/B978-0-12-336156-1.50061-6) — kind: paper; author: Karel Zuiderveld; year: 1994; the original CLAHE paper that `cv2.createCLAHE` implements.
- [Histogram equalization — Wikipedia](https://en.wikipedia.org/wiki/Histogram_equalization) — kind: article; cumulative-distribution-function explanation that backs the equalisation step.

## Corner Detection with Harris and Shi-Tomasi

- [Harris, C. and Stephens, M. — *A Combined Corner and Edge Detector* (1988)](https://doi.org/10.5244/C.2.23) — kind: paper; author: Chris Harris and Mike Stephens; year: 1988; original Harris-corner paper.
- [Shi, J. and Tomasi, C. — *Good Features to Track* (1994)](https://doi.org/10.1109/CVPR.1994.323794) — kind: paper; author: Jianbo Shi and Carlo Tomasi; year: 1994; primary reference for `goodFeaturesToTrack`.
- [OpenCV — Harris Corner Detection](https://docs.opencv.org/4.x/dc/d0d/tutorial_py_features_harris.html) — kind: article; official tutorial covering `cornerHarris`, `cornerSubPix`, and the `k` parameter.
- [OpenCV — Shi-Tomasi Corner Detector & Good Features to Track](https://docs.opencv.org/4.x/d4/d8c/tutorial_py_shi_tomasi.html) — kind: article; canonical reference for `goodFeaturesToTrack`.

## Keypoint Descriptors: SIFT, ORB, and AKAZE

- [Lowe, D. G. — *Distinctive Image Features from Scale-Invariant Keypoints* (2004)](https://doi.org/10.1023/B:VISI.0000029664.99615.94) — kind: paper; author: David G. Lowe; year: 2004; the SIFT paper.
- [Rublee, E. et al. — *ORB: An efficient alternative to SIFT or SURF* (2011)](https://doi.org/10.1109/ICCV.2011.6126544) — kind: paper; author: Ethan Rublee, Vincent Rabaud, Kurt Konolige, Gary Bradski; year: 2011; the ORB paper.
- [Alcantarilla, P. F. et al. — *Fast Explicit Diffusion for Accelerated Features in Nonlinear Scale Spaces* (AKAZE, 2013)](https://www.bmva.org/bmvc/2013/Papers/paper0013/index.html) — kind: paper; author: Pablo F. Alcantarilla, Jesús Nuevo, Adrien Bartoli; year: 2013; the AKAZE paper.
- [OpenCV — Introduction to SIFT](https://docs.opencv.org/4.x/da/df5/tutorial_py_sift_intro.html) — kind: article; official tutorial.
- [OpenCV — ORB (Oriented FAST and Rotated BRIEF)](https://docs.opencv.org/4.x/d1/d89/tutorial_py_orb.html) — kind: article; official tutorial.

## Feature Matching with Brute-Force and FLANN

- [OpenCV — Feature Matching](https://docs.opencv.org/4.x/dc/dc3/tutorial_py_matcher.html) — kind: article; official tutorial covering `BFMatcher` and `FlannBasedMatcher` with the ratio test.
- [Lowe, D. G. — *Distinctive Image Features from Scale-Invariant Keypoints* (2004)](https://doi.org/10.1023/B:VISI.0000029664.99615.94) — kind: paper; author: David G. Lowe; year: 2004; §7.1 introduces the 0.7 ratio test the matching code uses.
- [Muja, M. and Lowe, D. G. — *Fast Approximate Nearest Neighbors with Automatic Algorithm Configuration* (2009)](https://www.cs.ubc.ca/research/flann/uploads/FLANN/flann_visapp09.pdf) — kind: paper; author: Marius Muja and David G. Lowe; year: 2009; the FLANN paper that backs `cv2.FlannBasedMatcher`.
- [k-d tree — Wikipedia](https://en.wikipedia.org/wiki/K-d_tree) — kind: article; foundational data structure for FLANN's `KDTreeIndexParams`.

## Homography Estimation and Image Stitching

- [OpenCV — Feature Matching + Homography to find Objects](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html) — kind: article; official walkthrough of `findHomography` + `warpPerspective`.
- [OpenCV — High level Stitching API (Stitcher class)](https://docs.opencv.org/4.x/d8/d19/tutorial_stitcher.html) — kind: article; official tutorial for `cv2.Stitcher_create()`.
- [Fischler, M. A. and Bolles, R. C. — *Random Sample Consensus* (1981)](https://doi.org/10.1145/358669.358692) — kind: paper; author: Martin A. Fischler and Robert C. Bolles; year: 1981; the original RANSAC paper.
- [Brown, M. and Lowe, D. G. — *Automatic Panoramic Image Stitching using Invariant Features* (2007)](https://doi.org/10.1007/s11263-006-0002-3) — kind: paper; author: Matthew Brown and David G. Lowe; year: 2007; primary reference for invariant-feature panorama stitching.

## Template Matching for Object Localization

- [OpenCV — Template Matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html) — kind: article; official tutorial for `cv2.matchTemplate` and the six similarity metrics.
- [Template matching — Wikipedia](https://en.wikipedia.org/wiki/Template_matching) — kind: article; survey of NCC, SAD, SSD, and ZNCC formulas.
- [Cross-correlation — Wikipedia](https://en.wikipedia.org/wiki/Cross-correlation) — kind: article; foundational definition of normalised cross-correlation that `TM_CCOEFF_NORMED` implements.

## Working with Video Streams and Webcams

- [OpenCV — Getting Started with Videos](https://docs.opencv.org/4.x/dd/d43/tutorial_py_video_display.html) — kind: article; official tutorial for `cv2.VideoCapture`, `cv2.VideoWriter`, and per-frame loops.
- [`cv2.VideoCapture` API reference](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html) — kind: article; canonical method/property reference, including capture-property flags (`CAP_PROP_*`).
- [FOURCC code — Wikipedia](https://en.wikipedia.org/wiki/FourCC) — kind: article; explains the four-character codec identifiers `cv2.VideoWriter_fourcc` consumes.

## Background Subtraction for Motion Detection

- [OpenCV — How to Use Background Subtraction Methods](https://docs.opencv.org/4.x/d1/dc5/tutorial_background_subtraction.html) — kind: article; official walkthrough of `BackgroundSubtractorMOG2` and `BackgroundSubtractorKNN`.
- [Zivkovic, Z. — *Improved Adaptive Gaussian Mixture Model for Background Subtraction* (2004)](https://doi.org/10.1109/ICPR.2004.1333992) — kind: paper; author: Zoran Zivkovic; year: 2004; the MOG2 paper.
- [Zivkovic, Z. and van der Heijden, F. — *Efficient Adaptive Density Estimation per Image Pixel for the Task of Background Subtraction* (KNN, 2006)](https://doi.org/10.1016/j.patrec.2005.11.005) — kind: paper; author: Zoran Zivkovic and Ferdinand van der Heijden; year: 2006; the KNN-subtractor paper.

## Optical Flow: Lucas-Kanade and Farneback

- [Lucas, B. D. and Kanade, T. — *An Iterative Image Registration Technique with an Application to Stereo Vision* (1981)](https://www.ri.cmu.edu/pub_files/pub3/lucas_bruce_d_1981_2/lucas_bruce_d_1981_2.pdf) — kind: paper; author: Bruce D. Lucas and Takeo Kanade; year: 1981; original LK paper, hosted on the CMU Robotics Institute publications page.
- [Farnebäck, G. — *Two-Frame Motion Estimation Based on Polynomial Expansion* (2003)](https://doi.org/10.1007/3-540-45103-X_50) — kind: paper; author: Gunnar Farnebäck; year: 2003; the Farnebäck dense-flow paper that `calcOpticalFlowFarneback` implements.
- [OpenCV — Optical Flow](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html) — kind: article; official tutorial covering both sparse (`calcOpticalFlowPyrLK`) and dense (`calcOpticalFlowFarneback`).
- [Optical flow — Wikipedia](https://en.wikipedia.org/wiki/Optical_flow) — kind: article; brightness-constancy assumption and the aperture problem.

## Object Tracking with OpenCV Trackers

- [OpenCV — Tracking API tutorials](https://docs.opencv.org/4.x/d2/d0a/tutorial_introduction_to_tracker.html) — kind: article; official entry point for the legacy and modern tracker APIs.
- [Lukežič, A. et al. — *Discriminative Correlation Filter with Channel and Spatial Reliability* (CSRT, 2017)](https://doi.org/10.1109/CVPR.2017.515) — kind: paper; author: Alan Lukežič, Tomáš Vojíř, Luka Čehovin Zajc, Jiří Matas, Matej Kristan; year: 2017; the CSRT paper.
- [Henriques, J. F. et al. — *High-Speed Tracking with Kernelized Correlation Filters* (KCF, 2015)](https://doi.org/10.1109/TPAMI.2014.2345390) — kind: paper; author: João F. Henriques, Rui Caseiro, Pedro Martins, Jorge Batista; year: 2015; the KCF paper.
- [Bolme, D. S. et al. — *Visual Object Tracking using Adaptive Correlation Filters* (MOSSE, 2010)](https://doi.org/10.1109/CVPR.2010.5539960) — kind: paper; author: David S. Bolme, J. Ross Beveridge, Bruce A. Draper, Yui Man Lui; year: 2010; the MOSSE paper.

## Face Detection with Haar Cascades

- [Viola, P. and Jones, M. — *Rapid Object Detection using a Boosted Cascade of Simple Features* (2001)](https://doi.org/10.1109/CVPR.2001.990517) — kind: paper; author: Paul Viola and Michael Jones; year: 2001; the original cascade-classifier paper.
- [OpenCV — Face Detection using Haar Cascades](https://docs.opencv.org/4.x/d2/d99/tutorial_face_landmark_detection_in_an_image.html) — kind: article; official tutorial for `cv2.CascadeClassifier`.
- [OpenCV — Cascade Classifier (training and use)](https://docs.opencv.org/4.x/db/d28/tutorial_cascade_classifier.html) — kind: article; covers the bundled `haarcascade_*.xml` models and how to invoke them.
- [Haar-like feature — Wikipedia](https://en.wikipedia.org/wiki/Haar-like_feature) — kind: article; reference for the rectangular feature templates that AdaBoost selects.

## Camera Calibration and Undistortion

- [Zhang, Z. — *A Flexible New Technique for Camera Calibration* (2000)](https://doi.org/10.1109/34.888718) — kind: paper; author: Zhengyou Zhang; year: 2000; the chessboard-based calibration method `calibrateCamera` implements.
- [OpenCV — Camera calibration with OpenCV](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html) — kind: article; canonical Python tutorial for `findChessboardCorners`, `calibrateCamera`, `undistort`, `getOptimalNewCameraMatrix`.
- [Pinhole camera model — Wikipedia](https://en.wikipedia.org/wiki/Pinhole_camera_model) — kind: article; reference for the intrinsics matrix `K` and the perspective projection equation.
- [Multiple View Geometry in Computer Vision, 2nd ed. — Ch. 6 (Camera Models)](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; rigorous treatment of intrinsics, extrinsics, and the distortion model.

## Bridging to Deep Learning with cv2.dnn

- [OpenCV — Deep Neural Networks (`cv2.dnn`) module](https://docs.opencv.org/4.x/d2/d58/tutorial_table_of_content_dnn.html) — kind: article; official tutorial root for the DNN module — backends, targets, importing models.
- [OpenCV `dnn` — DNNBackend / DNNTarget reference](https://docs.opencv.org/4.x/d6/d0f/group__dnn.html) — kind: article; canonical API listing for `readNetFromONNX`, `blobFromImage`, and `forward`.
- [ONNX Runtime — Open Neural Network Exchange](https://onnx.ai/) — kind: article; reference for the model format `cv2.dnn.readNetFromONNX` consumes.
- [Howard, A. G. et al. — *MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications* (2017)](https://arxiv.org/abs/1704.04861) — kind: paper; author: Andrew G. Howard et al.; year: 2017; the MobileNet paper backing the small classifier the lesson runs through `cv2.dnn`.

## Capstone: Building a Mini Vision Pipeline

- [OpenCV — OpenCV-Python Tutorials (root index)](https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html) — kind: article; the canonical Python tutorial index; the capstone leans on it as a pick-your-own-recipe reference.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; chapter index for end-to-end pipeline composition.
- [scikit-image gallery (project examples)](https://scikit-image.org/docs/stable/auto_examples/index.html) — kind: article; official scikit-image example gallery — useful side-by-side comparison fodder for the capstone's "what library does which step" discussion.
- [OpenCV — Releases and changelog](https://github.com/opencv/opencv/wiki/ChangeLog) — kind: article; first-party changelog the capstone can cite when discussing version pinning and reproducibility.

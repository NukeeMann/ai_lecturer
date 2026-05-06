# Sources: OpenCV w wizji komputerowej: od podstaw do SAR

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; freely-available textbook covering filtering, features, segmentation, motion, geometry — fits 6 of 8 modules.
- [Digital Image Processing, 4th ed. — companion site](https://www.imageprocessingplace.com/) — kind: book; author: Rafael C. Gonzalez and Richard E. Woods; year: 2018; canonical undergraduate textbook covering enhancement, morphology, filtering, frequency-domain methods, segmentation.
- [OpenCV documentation — main tutorials index (4.x)](https://docs.opencv.org/4.x/d9/df8/tutorial_root.html) — kind: article; official tutorials grouped by topic; the primary reference for every API call in the course.
- [OpenCV Python tutorials (4.x)](https://docs.opencv.org/4.x/d6/d00/tutorial_py_root.html) — kind: article; the Python-flavoured walkthrough of every major OpenCV module.
- [scikit-image documentation](https://scikit-image.org/docs/stable/) — kind: article; auxiliary reference for algorithms whose OpenCV form differs (SLIC, GLCM via `skimage.feature.graycomatrix`, Refined Lee).
- [NumPy user guide](https://numpy.org/doc/stable/user/index.html) — kind: article; foundational ndarray reference used in every coding lesson.
- [Multiple View Geometry in Computer Vision, 2nd ed.](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; the standard reference for projective geometry, calibration, stereo, and PnP.
- [ESA Sentinel-1 SAR User Guide](https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar) — kind: article; official ESA reference for product types, polarisations, processing levels.
- [Alaska Satellite Facility (ASF) — SAR data search and tutorials](https://asf.alaska.edu/datasets/sar-data-sets/) — kind: article; primary download portal for Sentinel-1 plus introductory SAR tutorials.

---

## Czym jest OpenCV i kiedy go używać

- [OpenCV — Wikipedia](https://en.wikipedia.org/wiki/OpenCV) — kind: article; concise history of the library, its modules, and licensing.
- [OpenCV — About page](https://opencv.org/about/) — kind: article; current scope, governance (OpenCV Foundation), and ecosystem.
- [Learning OpenCV 3](https://www.oreilly.com/library/view/learning-opencv-3/9781491937983/) — kind: book; author: Adrian Kaehler and Gary Bradski; year: 2017; foundational textbook by the original creators.

## Instalacja i konfiguracja środowiska

- [OpenCV — Installation in Python (PyPI)](https://pypi.org/project/opencv-python/) — kind: article; official pip package; explains the `opencv-python` vs `opencv-contrib-python` vs `opencv-python-headless` choice.
- [Python venv — official documentation](https://docs.python.org/3/library/venv.html) — kind: article; standard library reference for virtual environments.
- [Conda user guide — Managing environments](https://docs.conda.io/projects/conda/en/stable/user-guide/tasks/manage-environments.html) — kind: article; alternative environment manager popular in scientific-Python and SAR workflows.

## Reprezentacja obrazu jako tablicy NumPy

- [NumPy — The N-dimensional array (`ndarray`)](https://numpy.org/doc/stable/reference/arrays.ndarray.html) — kind: article; defines shape, dtype, strides — the contract OpenCV operates on.
- [OpenCV Python tutorial — Basic operations on images](https://docs.opencv.org/4.x/d3/df2/tutorial_py_basic_ops.html) — kind: article; canonical "image is a NumPy array" walkthrough.
- [Pixel — Wikipedia](https://en.wikipedia.org/wiki/Pixel) — kind: article; the pixel model and quantisation depths (8-bit, 16-bit, float).

## Wczytywanie, wyświetlanie i zapis obrazów

- [OpenCV Python tutorial — Getting started with images (`imread`/`imshow`/`imwrite`)](https://docs.opencv.org/4.x/db/deb/tutorial_display_image.html) — kind: article; the canonical first-steps tutorial.
- [`cv2.imread` — OpenCV API reference](https://docs.opencv.org/4.x/d4/da8/group__imgcodecs.html#ga288b8b3da0892bd651fce07b3bbd3a56) — kind: article; the primary read function and its colour-flag enum.
- [BGR vs RGB — OpenCV Python tutorial on colour conversion (`cvtColor`)](https://docs.opencv.org/4.x/df/d9d/tutorial_py_colorspaces.html) — kind: article; explains the BGR default and the `COLOR_BGR2RGB` swap that haunts every newcomer.

## Praca z wideo i strumieniami

- [OpenCV Python tutorial — Video I/O (`VideoCapture`/`VideoWriter`)](https://docs.opencv.org/4.x/dd/d43/tutorial_py_video_display.html) — kind: article; reading from files and webcams, writing back.
- [`cv2.VideoCapture` — OpenCV API reference](https://docs.opencv.org/4.x/d8/dfe/classcv_1_1VideoCapture.html) — kind: article; full constructor and property reference.
- [FFmpeg documentation](https://ffmpeg.org/documentation.html) — kind: article; OpenCV's video back-end on Linux/macOS — useful for codec-related troubleshooting.

## Przestrzenie barw: BGR, HSV, LAB, Gray

- [HSL and HSV — Wikipedia](https://en.wikipedia.org/wiki/HSL_and_HSV) — kind: article; the cylindrical colour models and their geometric interpretation.
- [CIELAB color space — Wikipedia](https://en.wikipedia.org/wiki/CIELAB_color_space) — kind: article; perceptually-uniform colour space useful for colour-difference measurement.
- [OpenCV Python tutorial — Changing colorspaces](https://docs.opencv.org/4.x/df/d9d/tutorial_py_colorspaces.html) — kind: article; the `cvtColor` codes and a practical "track an object by colour" example.

## Arytmetyka obrazów i alpha blending

- [OpenCV Python tutorial — Arithmetic operations on images](https://docs.opencv.org/4.x/d0/d86/tutorial_py_image_arithmetics.html) — kind: article; covers `add`, `addWeighted`, saturation behaviour.
- [Alpha compositing — Wikipedia](https://en.wikipedia.org/wiki/Alpha_compositing) — kind: article; mathematics of `out = α·A + (1 − α)·B`.
- [Porter, T. and Duff, T. — *Compositing Digital Images* (SIGGRAPH 1984)](https://doi.org/10.1145/964965.808606) — kind: paper; author: Thomas Porter and Tom Duff; year: 1984; the original compositing-algebra paper.

## Operacje logiczne i maski binarne

- [OpenCV Python tutorial — Image arithmetic (bitwise section)](https://docs.opencv.org/4.x/d0/d86/tutorial_py_image_arithmetics.html) — kind: article; `bitwise_and`, `bitwise_or`, `bitwise_not`, masking idioms.
- [Bit manipulation — Wikipedia](https://en.wikipedia.org/wiki/Bit_manipulation) — kind: article; primer on bitwise operators and their truth tables.
- [NumPy — Boolean array indexing](https://numpy.org/doc/stable/user/basics.indexing.html#boolean-array-indexing) — kind: article; the "mask as boolean ndarray" idiom that OpenCV interoperates with.

## Histogramy i ich interpretacja

- [OpenCV Python tutorial — Histograms (1: find, plot, analyze)](https://docs.opencv.org/4.x/d1/db7/tutorial_py_histogram_begins.html) — kind: article; canonical tutorial with `calcHist` plus matplotlib plotting.
- [Image histogram — Wikipedia](https://en.wikipedia.org/wiki/Image_histogram) — kind: article; what a histogram says about exposure, contrast, dynamic range.
- [`numpy.histogram` reference](https://numpy.org/doc/stable/reference/generated/numpy.histogram.html) — kind: article; alternative implementation and the `bin_edges` / `counts` convention used by the Histogram widget.

## Wyrównanie histogramu i CLAHE

- [Histogram equalization — Wikipedia](https://en.wikipedia.org/wiki/Histogram_equalization) — kind: article; the global formulation and its limits.
- [Adaptive histogram equalization (CLAHE) — Wikipedia](https://en.wikipedia.org/wiki/Adaptive_histogram_equalization#Contrast_Limited_AHE) — kind: article; CLAHE's clip-limit + tile-grid mechanics.
- [Zuiderveld, K. — *Contrast Limited Adaptive Histogram Equalization* (Graphics Gems IV, 1994)](https://doi.org/10.1016/B978-0-12-336156-1.50061-6) — kind: paper; author: Karel Zuiderveld; year: 1994; the original CLAHE reference; defines the bilinear-interpolation step OpenCV uses.

## Transformacje geometryczne: skalowanie i obrót

- [OpenCV Python tutorial — Geometric transformations of images](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html) — kind: article; `resize`, `warpAffine`, `getRotationMatrix2D`.
- [Image scaling — Wikipedia](https://en.wikipedia.org/wiki/Image_scaling) — kind: article; nearest, bilinear, bicubic, Lanczos interpolation compared.
- [Bilinear interpolation — Wikipedia](https://en.wikipedia.org/wiki/Bilinear_interpolation) — kind: article; the default `INTER_LINEAR` interpolation used by `cv2.resize`.

## Transformacje afiniczne i perspektywiczne

- [Affine transformation — Wikipedia](https://en.wikipedia.org/wiki/Affine_transformation) — kind: article; the 2 × 3 matrix form OpenCV consumes.
- [Homography (computer vision) — Wikipedia](https://en.wikipedia.org/wiki/Homography_(computer_vision)) — kind: article; the projective 3 × 3 matrix and its DLT solution.
- [Computer Vision: Algorithms and Applications, 2nd ed. — § 8 Image alignment](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; treatment of affine and projective alignment with worked examples.

## Wyostrzanie i unsharp masking

- [Unsharp masking — Wikipedia](https://en.wikipedia.org/wiki/Unsharp_masking) — kind: article; the `original + α·(original − blurred)` recipe.
- [scikit-image — `unsharp_mask` reference](https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.unsharp_mask) — kind: article; reference implementation with the same control parameters.
- [Digital Image Processing, 4th ed. — § 3 (Image Enhancement)](https://www.imageprocessingplace.com/) — kind: book; author: Rafael C. Gonzalez and Richard E. Woods; year: 2018; covers unsharp masking and high-boost filtering.

## Mini-projekt: skaner dokumentów

- [OpenCV Python tutorial — Geometric transformations (perspective section)](https://docs.opencv.org/4.x/da/d6e/tutorial_py_geometric_transformations.html) — kind: article; `getPerspectiveTransform` + `warpPerspective` example.
- [OpenCV Python tutorial — Adaptive thresholding](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html) — kind: article; the `adaptiveThreshold` step that converts a deskewed page to clean black-on-white.
- [Suzuki, S. and Abe, K. — *Topological structural analysis of digitized binary images by border following* (CVGIP 1985)](https://doi.org/10.1016/0734-189X(85)90016-7) — kind: paper; author: Satoshi Suzuki and Keiichi Abe; year: 1985; the algorithm behind `findContours` used to locate the page boundary.

## Konwolucja 2D i jądra filtrów

- [Kernel (image processing) — Wikipedia](https://en.wikipedia.org/wiki/Kernel_(image_processing)) — kind: article; visual catalogue of common kernels and their effects.
- [Convolution — Wikipedia](https://en.wikipedia.org/wiki/Convolution) — kind: article; the mathematical definition and its relation to correlation.
- [OpenCV — `filter2D` API reference](https://docs.opencv.org/4.x/d4/d86/group__imgproc__filter.html#ga27c049795ce870216ddfb366086b5a04) — kind: article; the convolution-vs-correlation note OpenCV's API exposes.

## Filtry rozmywające: średni, Gaussa, medianowy

- [Gaussian blur — Wikipedia](https://en.wikipedia.org/wiki/Gaussian_blur) — kind: article; the kernel formula, σ-vs-radius rule, separability.
- [Median filter — Wikipedia](https://en.wikipedia.org/wiki/Median_filter) — kind: article; non-linear, edge-preserving, salt-and-pepper specialist.
- [OpenCV Python tutorial — Smoothing images](https://docs.opencv.org/4.x/d4/d13/tutorial_py_filtering.html) — kind: article; `blur`, `GaussianBlur`, `medianBlur` worked through.

## Filtr bilateralny i zachowanie krawędzi

- [Bilateral filter — Wikipedia](https://en.wikipedia.org/wiki/Bilateral_filter) — kind: article; the photometric × geometric weight formula.
- [Tomasi, C. and Manduchi, R. — *Bilateral Filtering for Gray and Color Images* (ICCV 1998)](https://doi.org/10.1109/ICCV.1998.710815) — kind: paper; author: Carlo Tomasi and Roberto Manduchi; year: 1998; the original bilateral-filter paper.
- [OpenCV — `bilateralFilter` API reference](https://docs.opencv.org/4.x/d4/d86/group__imgproc__filter.html#ga9d7064d478c95d60003cf839430737ed) — kind: article; the API and its computational-cost note.

## Filtry gradientowe: Sobel i Scharr

- [Sobel operator — Wikipedia](https://en.wikipedia.org/wiki/Sobel_operator) — kind: article; the 3 × 3 kernels and the Scharr improvement noted.
- [OpenCV Python tutorial — Image gradients (`Sobel`/`Scharr`/`Laplacian`)](https://docs.opencv.org/4.x/d5/d0f/tutorial_py_gradients.html) — kind: article; the practical comparison of Sobel and Scharr.
- [Scharr, H. — *Optimal Operators in Digital Image Processing* (Ph.D. thesis, 2000)](https://doi.org/10.11588/heidok.00000962) — kind: paper; author: Hanno Scharr; year: 2000; the source of the rotation-symmetry-optimal Scharr kernel.

## Operator Laplace i zera przejścia

- [Discrete Laplace operator — Wikipedia](https://en.wikipedia.org/wiki/Discrete_Laplace_operator) — kind: article; the 3 × 3 kernel and zero-crossing logic.
- [OpenCV — `Laplacian` API reference](https://docs.opencv.org/4.x/d4/d86/group__imgproc__filter.html#gad78703e4c8fe703d479c1860d76429e6) — kind: article; ksize, scale, and float-output guidance.
- [Marr, D. and Hildreth, E. — *Theory of Edge Detection* (Proc. R. Soc. B, 1980)](https://doi.org/10.1098/rspb.1980.0020) — kind: paper; author: David Marr and Ellen Hildreth; year: 1980; the Laplacian-of-Gaussian / zero-crossing edge model.

## Progowanie globalne i metoda Otsu

- [Otsu's method — Wikipedia](https://en.wikipedia.org/wiki/Otsu%27s_method) — kind: article; the inter-class-variance derivation.
- [Otsu, N. — *A Threshold Selection Method from Gray-Level Histograms* (IEEE TSMC 1979)](https://doi.org/10.1109/TSMC.1979.4310076) — kind: paper; author: Nobuyuki Otsu; year: 1979; the original paper.
- [OpenCV Python tutorial — Image thresholding](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html) — kind: article; `cv2.threshold` with `THRESH_OTSU` worked example.

## Progowanie adaptacyjne

- [OpenCV Python tutorial — Image thresholding (adaptive section)](https://docs.opencv.org/4.x/d7/d4d/tutorial_py_thresholding.html) — kind: article; `adaptiveThreshold` with mean and Gaussian neighbourhood.
- [Bradley, D. and Roth, G. — *Adaptive Thresholding using the Integral Image* (Journal of Graphics Tools, 2007)](https://doi.org/10.1080/2151237X.2007.10129236) — kind: paper; author: Derek Bradley and Gerhard Roth; year: 2007; the Bradley-Roth adaptive method behind many implementations.
- [scikit-image — `threshold_local` reference](https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.threshold_local) — kind: article; cross-implementation reference.

## Operacje morfologiczne na obrazach binarnych

- [Mathematical morphology — Wikipedia](https://en.wikipedia.org/wiki/Mathematical_morphology) — kind: article; erosion, dilation, opening, closing, top-hat unified.
- [OpenCV Python tutorial — Morphological transformations](https://docs.opencv.org/4.x/d9/d61/tutorial_py_morphological_ops.html) — kind: article; the worked-image walkthrough.
- [Serra, J. — *Image Analysis and Mathematical Morphology* (Academic Press, 1982)](https://www.sciencedirect.com/book/9780126372403/image-analysis-and-mathematical-morphology) — kind: book; author: Jean Serra; year: 1982; the foundational text on morphology.

## Szkieletyzacja i transformata dystansu

- [Topological skeleton — Wikipedia](https://en.wikipedia.org/wiki/Topological_skeleton) — kind: article; the medial-axis idea and its computation strategies.
- [OpenCV — `distanceTransform` API reference](https://docs.opencv.org/4.x/d7/d1b/group__imgproc__misc.html#ga8a0b7fdfcb7a13dde018988ba3a43042) — kind: article; the L1 / L2 metrics and 3×3 / 5×5 masks.
- [Felzenszwalb, P. F. and Huttenlocher, D. P. — *Distance Transforms of Sampled Functions* (Theory of Computing, 2012)](https://doi.org/10.4086/toc.2012.v008a019) — kind: paper; author: Pedro F. Felzenszwalb and Daniel P. Huttenlocher; year: 2012; the linear-time algorithm behind modern distance-transform implementations.

## Detektor Canny krok po kroku

- [Canny, J. — *A Computational Approach to Edge Detection* (IEEE TPAMI 1986)](https://doi.org/10.1109/TPAMI.1986.4767851) — kind: paper; author: John Canny; year: 1986; the original four-stage paper.
- [Canny edge detector — Wikipedia](https://en.wikipedia.org/wiki/Canny_edge_detector) — kind: article; readable summary of blur → gradient → NMS → hysteresis.
- [OpenCV Python tutorial — Canny edge detection](https://docs.opencv.org/4.x/da/d22/tutorial_py_canny.html) — kind: article; the practical low/high-threshold-tuning walkthrough.

## Znajdowanie konturów i hierarchia

- [OpenCV Python tutorial — Contours: getting started (`findContours`)](https://docs.opencv.org/4.x/d4/d73/tutorial_py_contours_begin.html) — kind: article; `RETR_EXTERNAL`, `RETR_LIST`, `RETR_TREE`, `CHAIN_APPROX_SIMPLE`.
- [Suzuki, S. and Abe, K. — *Topological structural analysis of digitized binary images by border following* (CVGIP 1985)](https://doi.org/10.1016/0734-189X(85)90016-7) — kind: paper; author: Satoshi Suzuki and Keiichi Abe; year: 1985; the border-following algorithm OpenCV implements.
- [OpenCV Python tutorial — Contour hierarchy](https://docs.opencv.org/4.x/d9/d8b/tutorial_py_contours_hierarchy.html) — kind: article; how the hierarchy array is laid out.

## Aproksymacja konturów i momenty

- [OpenCV Python tutorial — Contour features (area, perimeter, moments, approxPolyDP)](https://docs.opencv.org/4.x/dd/d49/tutorial_py_contour_features.html) — kind: article; the practical cookbook.
- [Image moment — Wikipedia](https://en.wikipedia.org/wiki/Image_moment) — kind: article; raw, central, and normalised central moments and their geometric meaning.
- [Douglas, D. H. and Peucker, T. K. — *Algorithms for the Reduction of the Number of Points Required to Represent a Digitized Line or its Caricature* (Cartographica 1973)](https://doi.org/10.3138/FM57-6770-U75U-7727) — kind: paper; author: David H. Douglas and Thomas K. Peucker; year: 1973; the algorithm behind `approxPolyDP`.

## Convex hull i defekty

- [Convex hull — Wikipedia](https://en.wikipedia.org/wiki/Convex_hull) — kind: article; the geometric concept and common computational algorithms.
- [OpenCV Python tutorial — More functions on contours (convex hull, defects)](https://docs.opencv.org/4.x/d5/d45/tutorial_py_contours_more_functions.html) — kind: article; `convexHull`, `convexityDefects`.
- [Sklansky, J. — *Finding the convex hull of a simple polygon* (Pattern Recognition Letters, 1982)](https://doi.org/10.1016/0167-8655(82)90016-2) — kind: paper; author: Jack Sklansky; year: 1982; the algorithm OpenCV uses inside `convexHull`.

## matchShapes i momenty Hu

- [Hu, M.-K. — *Visual pattern recognition by moment invariants* (IRE Transactions on Information Theory, 1962)](https://doi.org/10.1109/TIT.1962.1057692) — kind: paper; author: Ming-Kuei Hu; year: 1962; the original seven-invariants paper.
- [OpenCV — `HuMoments` and `matchShapes` API references](https://docs.opencv.org/4.x/d8/d23/classcv_1_1Moments.html) — kind: article; the moments class and shape-matching call.
- [Image moment — Wikipedia (Hu invariants section)](https://en.wikipedia.org/wiki/Image_moment#Rotation_invariants) — kind: article; concise summary of the seven Hu invariants.

## Transformata Hougha dla linii

- [Hough transform — Wikipedia](https://en.wikipedia.org/wiki/Hough_transform) — kind: article; the (ρ, θ) parameterisation and accumulator voting.
- [Duda, R. O. and Hart, P. E. — *Use of the Hough Transformation to Detect Lines and Curves in Pictures* (CACM 1972)](https://doi.org/10.1145/361237.361242) — kind: paper; author: Richard O. Duda and Peter E. Hart; year: 1972; the (ρ, θ) reformulation OpenCV implements.
- [OpenCV Python tutorial — Hough Line Transform](https://docs.opencv.org/4.x/d6/d10/tutorial_py_houghlines.html) — kind: article; classical and probabilistic variants compared.

## Wykrywanie okręgów HoughCircles

- [Hough transform — Wikipedia (circle section)](https://en.wikipedia.org/wiki/Circle_Hough_Transform) — kind: article; the 3-D accumulator and centre-radius voting.
- [OpenCV Python tutorial — Hough Circle Transform](https://docs.opencv.org/4.x/da/d53/tutorial_py_houghcircles.html) — kind: article; `HoughCircles` parameters and a coin-detection example.
- [Yuen, H. K. et al. — *Comparative study of Hough Transform methods for circle finding* (Image and Vision Computing, 1990)](https://doi.org/10.1016/0262-8856(90)90059-E) — kind: paper; author: H. K. Yuen, J. Princen, J. Illingworth and J. Kittler; year: 1990; comparison of HT-circle variants including the gradient-method behind OpenCV's default.

## Detektory narożników: Harris i Shi-Tomasi

- [Harris, C. and Stephens, M. — *A Combined Corner and Edge Detector* (Alvey Vision Conference 1988)](https://doi.org/10.5244/C.2.23) — kind: paper; author: Chris Harris and Mike Stephens; year: 1988; the Harris-corner paper.
- [Shi, J. and Tomasi, C. — *Good Features to Track* (CVPR 1994)](https://doi.org/10.1109/CVPR.1994.323794) — kind: paper; author: Jianbo Shi and Carlo Tomasi; year: 1994; the min-eigenvalue criterion that becomes `goodFeaturesToTrack`.
- [OpenCV Python tutorial — Harris corner detection](https://docs.opencv.org/4.x/dc/d0d/tutorial_py_features_harris.html) — kind: article; the practical walkthrough.

## Deskryptory SIFT i SURF

- [Lowe, D. G. — *Distinctive Image Features from Scale-Invariant Keypoints* (IJCV 2004)](https://doi.org/10.1023/B:VISI.0000029664.99615.94) — kind: paper; author: David G. Lowe; year: 2004; the SIFT paper.
- [Bay, H., Tuytelaars, T. and Van Gool, L. — *SURF: Speeded Up Robust Features* (ECCV 2006)](https://doi.org/10.1007/11744023_32) — kind: paper; author: Herbert Bay, Tinne Tuytelaars and Luc Van Gool; year: 2006; the SURF paper.
- [OpenCV Python tutorial — Introduction to SIFT](https://docs.opencv.org/4.x/da/df5/tutorial_py_sift_intro.html) — kind: article; the practical walkthrough — note that SIFT is now in the main module post-2020.

## Szybkie deskryptory: ORB, BRISK, AKAZE

- [Rublee, E., Rabaud, V., Konolige, K. and Bradski, G. — *ORB: An efficient alternative to SIFT or SURF* (ICCV 2011)](https://doi.org/10.1109/ICCV.2011.6126544) — kind: paper; author: Ethan Rublee, Vincent Rabaud, Kurt Konolige and Gary Bradski; year: 2011; the ORB paper.
- [Leutenegger, S., Chli, M. and Siegwart, R. Y. — *BRISK: Binary Robust Invariant Scalable Keypoints* (ICCV 2011)](https://doi.org/10.1109/ICCV.2011.6126542) — kind: paper; author: Stefan Leutenegger, Margarita Chli and Roland Y. Siegwart; year: 2011; the BRISK paper.
- [Alcantarilla, P. F., Nuevo, J. and Bartoli, A. — *Fast Explicit Diffusion for Accelerated Features in Nonlinear Scale Spaces* (BMVC 2013)](https://doi.org/10.5244/C.27.13) — kind: paper; author: Pablo F. Alcantarilla, Jesús Nuevo and Adrien Bartoli; year: 2013; the AKAZE paper.

## Dopasowywanie cech: BFMatcher i FLANN

- [OpenCV Python tutorial — Feature Matching](https://docs.opencv.org/4.x/dc/dc3/tutorial_py_matcher.html) — kind: article; BFMatcher and FLANN compared with KNN matching plus Lowe's ratio test.
- [Muja, M. and Lowe, D. G. — *Fast Approximate Nearest Neighbors with Automatic Algorithm Configuration* (VISAPP 2009)](https://doi.org/10.5220/0001787803310340) — kind: paper; author: Marius Muja and David G. Lowe; year: 2009; the FLANN paper.
- [Lowe, D. G. — *Distinctive Image Features from Scale-Invariant Keypoints* (IJCV 2004)](https://doi.org/10.1023/B:VISI.0000029664.99615.94) — kind: paper; author: David G. Lowe; year: 2004; introduces the ratio test used for match filtering.

## Estymacja homografii i RANSAC

- [Fischler, M. A. and Bolles, R. C. — *Random Sample Consensus: A Paradigm for Model Fitting* (CACM 1981)](https://doi.org/10.1145/358669.358692) — kind: paper; author: Martin A. Fischler and Robert C. Bolles; year: 1981; the RANSAC paper.
- [OpenCV Python tutorial — Feature matching + Homography to find objects](https://docs.opencv.org/4.x/d1/de0/tutorial_py_feature_homography.html) — kind: article; `findHomography` with RANSAC end-to-end.
- [Multiple View Geometry in Computer Vision, 2nd ed. — § 4 Estimation](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; the canonical homography-estimation reference.

## Stitching i panoramy

- [Brown, M. and Lowe, D. G. — *Automatic Panoramic Image Stitching using Invariant Features* (IJCV 2007)](https://doi.org/10.1007/s11263-006-0002-3) — kind: paper; author: Matthew Brown and David G. Lowe; year: 2007; the algorithm OpenCV's Stitcher pipeline implements.
- [OpenCV — Stitching pipeline overview](https://docs.opencv.org/4.x/d1/d46/group__stitching.html) — kind: article; module-level reference for `cv2.Stitcher_create`.
- [Szeliski, R. — *Image Alignment and Stitching: A Tutorial* (Foundations and Trends in CGV, 2006)](https://doi.org/10.1561/0600000009) — kind: paper; author: Richard Szeliski; year: 2006; comprehensive stitching tutorial.

## Mini-projekt: stitcher panoramiczny

- [OpenCV — `Stitcher` class reference](https://docs.opencv.org/4.x/d2/d8d/classcv_1_1Stitcher.html) — kind: article; the high-level API and its modes (PANORAMA, SCANS).
- [Brown, M. and Lowe, D. G. — *Automatic Panoramic Image Stitching using Invariant Features* (IJCV 2007)](https://doi.org/10.1007/s11263-006-0002-3) — kind: paper; author: Matthew Brown and David G. Lowe; year: 2007; the reference algorithm.
- [OpenCV — Stitching detailed pipeline tutorial](https://docs.opencv.org/4.x/d8/d19/tutorial_stitcher.html) — kind: article; how to drop down to individual stages (matcher, warper, blender) when the high-level call fails.

## Template matching i jego ograniczenia

- [Template matching — Wikipedia](https://en.wikipedia.org/wiki/Template_matching) — kind: article; the SSD / NCC formulations and their failure modes.
- [OpenCV Python tutorial — Template Matching](https://docs.opencv.org/4.x/d4/dc6/tutorial_py_template_matching.html) — kind: article; `matchTemplate` walkthrough with `TM_*` flags.
- [Brunelli, R. — *Template Matching Techniques in Computer Vision: Theory and Practice* (Wiley, 2009)](https://doi.org/10.1002/9780470744055) — kind: book; author: Roberto Brunelli; year: 2009; a deeper textbook treatment.

## Detektor twarzy Haar Cascades

- [Viola, P. and Jones, M. — *Rapid Object Detection using a Boosted Cascade of Simple Features* (CVPR 2001)](https://doi.org/10.1109/CVPR.2001.990517) — kind: paper; author: Paul Viola and Michael Jones; year: 2001; the original Viola-Jones paper.
- [OpenCV Python tutorial — Face detection using Haar cascades](https://docs.opencv.org/4.x/d2/d99/tutorial_js_face_detection.html) — kind: article; loading the bundled XMLs and `detectMultiScale`.
- [Haar-like feature — Wikipedia](https://en.wikipedia.org/wiki/Haar-like_feature) — kind: article; the rectangular feature family with integral-image evaluation.

## Detektor pieszych HOG + SVM

- [Dalal, N. and Triggs, B. — *Histograms of Oriented Gradients for Human Detection* (CVPR 2005)](https://doi.org/10.1109/CVPR.2005.177) — kind: paper; author: Navneet Dalal and Bill Triggs; year: 2005; the canonical HOG+SVM pedestrian paper.
- [OpenCV — `HOGDescriptor` API reference](https://docs.opencv.org/4.x/d5/d33/structcv_1_1HOGDescriptor.html) — kind: article; the bundled people-detector and its parameters.
- [Histogram of oriented gradients — Wikipedia](https://en.wikipedia.org/wiki/Histogram_of_oriented_gradients) — kind: article; concise descriptor recipe and visualisation.

## Segmentacja k-means w przestrzeni barw

- [Lloyd, S. P. — *Least squares quantization in PCM* (IEEE Trans. Information Theory, 1982)](https://doi.org/10.1109/TIT.1982.1056489) — kind: paper; author: Stuart P. Lloyd; year: 1982; the canonical k-means / Lloyd algorithm reference.
- [OpenCV Python tutorial — K-Means clustering for color quantization](https://docs.opencv.org/4.x/d1/d5c/tutorial_py_kmeans_opencv.html) — kind: article; reshape → k-means → re-label idiom.
- [k-means clustering — Wikipedia](https://en.wikipedia.org/wiki/K-means_clustering) — kind: article; algorithm summary, k-means++ initialisation, common pitfalls.

## Algorytm Watershed i markery

- [Beucher, S. and Meyer, F. — *The Morphological Approach to Segmentation: The Watershed Transformation* (Mathematical Morphology in Image Processing, 1993)](https://doi.org/10.1201/9781482277234-12) — kind: paper; author: Serge Beucher and Fernand Meyer; year: 1993; the watershed-segmentation reference.
- [OpenCV Python tutorial — Image segmentation with watershed algorithm](https://docs.opencv.org/4.x/d3/db4/tutorial_py_watershed.html) — kind: article; marker-based variant with distance-transform seeds.
- [Watershed (image processing) — Wikipedia](https://en.wikipedia.org/wiki/Watershed_(image_processing)) — kind: article; the topographic-flooding metaphor and its algorithms.

## GrabCut do segmentacji interaktywnej

- [Rother, C., Kolmogorov, V. and Blake, A. — *"GrabCut": Interactive Foreground Extraction using Iterated Graph Cuts* (SIGGRAPH 2004)](https://doi.org/10.1145/1015706.1015720) — kind: paper; author: Carsten Rother, Vladimir Kolmogorov and Andrew Blake; year: 2004; the GrabCut paper.
- [OpenCV Python tutorial — Interactive foreground extraction using GrabCut](https://docs.opencv.org/4.x/d8/d83/tutorial_py_grabcut.html) — kind: article; the rect / mask initialisation modes.
- [Boykov, Y. and Funka-Lea, G. — *Graph Cuts and Efficient N-D Image Segmentation* (IJCV 2006)](https://doi.org/10.1007/s11263-006-7934-5) — kind: paper; author: Yuri Boykov and Gareth Funka-Lea; year: 2006; the graph-cut machinery GrabCut builds on.

## Optical flow rzadki i gęsty

- [Lucas, B. D. and Kanade, T. — *An Iterative Image Registration Technique with an Application to Stereo Vision* (IJCAI 1981)](https://www.ri.cmu.edu/publications/an-iterative-image-registration-technique-with-an-application-to-stereo-vision/) — kind: paper; author: Bruce D. Lucas and Takeo Kanade; year: 1981; the Lucas-Kanade paper hosted on the CMU RI publication archive.
- [Farnebäck, G. — *Two-Frame Motion Estimation Based on Polynomial Expansion* (SCIA 2003)](https://doi.org/10.1007/3-540-45103-X_50) — kind: paper; author: Gunnar Farnebäck; year: 2003; the Farnebäck dense-flow paper used by `cv2.calcOpticalFlowFarneback`.
- [OpenCV Python tutorial — Optical Flow](https://docs.opencv.org/4.x/d4/dee/tutorial_optical_flow.html) — kind: article; sparse Lucas-Kanade and dense Farnebäck side by side.

## Background subtraction MOG2 i KNN

- [Zivkovic, Z. — *Improved Adaptive Gaussian Mixture Model for Background Subtraction* (ICPR 2004)](https://doi.org/10.1109/ICPR.2004.1333992) — kind: paper; author: Zoran Zivkovic; year: 2004; the MOG2 paper.
- [Zivkovic, Z. and van der Heijden, F. — *Efficient adaptive density estimation per image pixel for the task of background subtraction* (Pattern Recognition Letters, 2006)](https://doi.org/10.1016/j.patrec.2005.11.005) — kind: paper; author: Zoran Zivkovic and Ferdinand van der Heijden; year: 2006; the KNN-background-subtraction paper.
- [OpenCV Python tutorial — Background subtraction](https://docs.opencv.org/4.x/d1/dc5/tutorial_background_subtraction.html) — kind: article; `createBackgroundSubtractorMOG2` and `createBackgroundSubtractorKNN`.

## Trackery KCF, CSRT i MOSSE

- [Henriques, J. F., Caseiro, R., Martins, P. and Batista, J. — *High-Speed Tracking with Kernelized Correlation Filters* (IEEE TPAMI 2015)](https://doi.org/10.1109/TPAMI.2014.2345390) — kind: paper; author: João F. Henriques, Rui Caseiro, Pedro Martins and Jorge Batista; year: 2015; the KCF paper.
- [Lukežič, A., Vojíř, T., Čehovin Zajc, L., Matas, J. and Kristan, M. — *Discriminative Correlation Filter Tracker with Channel and Spatial Reliability* (IJCV 2018)](https://doi.org/10.1007/s11263-017-1061-3) — kind: paper; author: Alan Lukežič, Tomáš Vojíř, Luka Čehovin Zajc, Jiří Matas and Matej Kristan; year: 2018; the CSRT paper.
- [Bolme, D. S., Beveridge, J. R., Draper, B. A. and Lui, Y. M. — *Visual Object Tracking using Adaptive Correlation Filters* (CVPR 2010)](https://doi.org/10.1109/CVPR.2010.5539960) — kind: paper; author: David S. Bolme, J. Ross Beveridge, Bruce A. Draper and Yui Man Lui; year: 2010; the MOSSE paper.

## Filtr Kalmana i mini-projekt MOT

- [Kalman, R. E. — *A New Approach to Linear Filtering and Prediction Problems* (ASME Journal of Basic Engineering 1960)](https://doi.org/10.1115/1.3662552) — kind: paper; author: Rudolf E. Kálmán; year: 1960; the original Kalman-filter paper.
- [OpenCV Python sample — Kalman filter (`samples/python/kalman.py`)](https://github.com/opencv/opencv/blob/4.x/samples/python/kalman.py) — kind: article; runnable sample bundled with OpenCV.
- [Welch, G. and Bishop, G. — *An Introduction to the Kalman Filter* (UNC-Chapel Hill TR 95-041, 2006)](https://www.cs.unc.edu/~welch/media/pdf/kalman_intro.pdf) — kind: paper; author: Greg Welch and Gary Bishop; year: 2006; the most-cited tutorial introduction.

## Model pinhole i kalibracja szachownicą

- [Zhang, Z. — *A Flexible New Technique for Camera Calibration* (IEEE TPAMI 2000)](https://doi.org/10.1109/34.888718) — kind: paper; author: Zhengyou Zhang; year: 2000; the chessboard-calibration algorithm OpenCV implements.
- [OpenCV — Camera calibration tutorial](https://docs.opencv.org/4.x/dc/dbb/tutorial_py_calibration.html) — kind: article; `findChessboardCorners`, `calibrateCamera`, reprojection-error reporting.
- [Multiple View Geometry in Computer Vision, 2nd ed. — § 6 Camera Models](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; pinhole-model derivation.

## Korekcja dystorsji i remapping

- [OpenCV — `undistort` and `initUndistortRectifyMap` API references](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html#ga69f2545a8b62a6b0fc2ee060dc30559d) — kind: article; the per-pixel remap that removes barrel/pincushion distortion.
- [Distortion (optics) — Wikipedia](https://en.wikipedia.org/wiki/Distortion_(optics)) — kind: article; radial vs tangential distortion models OpenCV uses.
- [Brown, D. C. — *Decentering Distortion of Lenses* (Photogrammetric Engineering, 1966)](https://www.asprs.org/wp-content/uploads/pers/1966journal/may/1966_may_444-462.pdf) — kind: paper; author: Duane C. Brown; year: 1966; the Brown-Conrady model behind OpenCV's distortion coefficients.

## Stereo wizja i mapy disparycji

- [Hirschmüller, H. — *Stereo Processing by Semi-Global Matching and Mutual Information* (IEEE TPAMI 2008)](https://doi.org/10.1109/TPAMI.2007.1166) — kind: paper; author: Heiko Hirschmüller; year: 2008; the SGM algorithm behind `cv2.StereoSGBM`.
- [OpenCV Python tutorial — Depth map from stereo images](https://docs.opencv.org/4.x/dd/d53/tutorial_py_depthmap.html) — kind: article; `StereoBM` / `StereoSGBM` worked example.
- [Multiple View Geometry in Computer Vision, 2nd ed. — § 11 Computation of the Fundamental Matrix](https://www.cambridge.org/core/books/multiple-view-geometry-in-computer-vision/0B6F289C78B2B23F596CAA76D3D43F7A) — kind: book; author: Richard Hartley and Andrew Zisserman; year: 2004; rectification and disparity-to-depth derivation.

## Estymacja pozy obiektu solvePnP

- [Lepetit, V., Moreno-Noguer, F. and Fua, P. — *EPnP: An Accurate O(n) Solution to the PnP Problem* (IJCV 2009)](https://doi.org/10.1007/s11263-008-0152-6) — kind: paper; author: Vincent Lepetit, Francesc Moreno-Noguer and Pascal Fua; year: 2009; the EPnP algorithm OpenCV uses for `SOLVEPNP_EPNP`.
- [OpenCV — `solvePnP` API reference](https://docs.opencv.org/4.x/d9/d0c/group__calib3d.html#ga549c2075fac14829ff4a58bc931c033d) — kind: article; the flag enum (ITERATIVE, EPNP, P3P, AP3P, IPPE).
- [OpenCV — Pose estimation tutorial](https://docs.opencv.org/4.x/d7/d53/tutorial_py_pose.html) — kind: article; chessboard + axes overlay end-to-end.

## FFT 2D i widmo amplitudy

- [Fast Fourier transform — Wikipedia](https://en.wikipedia.org/wiki/Fast_Fourier_transform) — kind: article; algorithm overview and the Cooley-Tukey decomposition.
- [OpenCV Python tutorial — Fourier Transform](https://docs.opencv.org/4.x/de/dbc/tutorial_py_fourier_transform.html) — kind: article; `dft`, `idft`, magnitude / phase visualisation.
- [Cooley, J. W. and Tukey, J. W. — *An Algorithm for the Machine Calculation of Complex Fourier Series* (Mathematics of Computation 1965)](https://doi.org/10.1090/S0025-5718-1965-0178586-1) — kind: paper; author: James W. Cooley and John W. Tukey; year: 1965; the FFT paper.

## Filtry pasmowe FFT i DCT

- [Discrete cosine transform — Wikipedia](https://en.wikipedia.org/wiki/Discrete_cosine_transform) — kind: article; the type-II DCT and its compaction property.
- [Ahmed, N., Natarajan, T. and Rao, K. R. — *Discrete Cosine Transform* (IEEE Transactions on Computers 1974)](https://doi.org/10.1109/T-C.1974.223784) — kind: paper; author: Nasir Ahmed, T. Natarajan and K. R. Rao; year: 1974; the original DCT paper.
- [OpenCV — `dct` API reference](https://docs.opencv.org/4.x/d2/de8/group__core__array.html#gadd6cf9baf2b8b704a11b5f04aaf4f39d) — kind: article; the OpenCV-side DCT implementation and its compatibility with JPEG.

## Wprowadzenie do falek 2D

- [Mallat, S. — *A Theory for Multiresolution Signal Decomposition: The Wavelet Representation* (IEEE TPAMI 1989)](https://doi.org/10.1109/34.192463) — kind: paper; author: Stéphane G. Mallat; year: 1989; the multi-resolution / wavelet-decomposition paper.
- [PyWavelets documentation](https://pywavelets.readthedocs.io/en/latest/) — kind: article; the de-facto Python wavelets library — used alongside OpenCV when wavelets are needed.
- [Wavelet — Wikipedia](https://en.wikipedia.org/wiki/Wavelet) — kind: article; concept overview and family table (Haar, Daubechies, biorthogonal).

## Profilowanie i wektoryzacja w OpenCV

- [Python `cProfile` — official documentation](https://docs.python.org/3/library/profile.html) — kind: article; the standard profiler used to find OpenCV-pipeline bottlenecks.
- [OpenCV Python tutorial — Performance measurement and improvement](https://docs.opencv.org/4.x/dc/d71/tutorial_py_optimization.html) — kind: article; `cv2.getTickCount`, `cv2.useOptimized`, vectorisation tips.
- [NumPy — Vectorization and broadcasting basics](https://numpy.org/doc/stable/user/basics.broadcasting.html) — kind: article; the broadcasting rules that replace Python pixel loops.

## Akceleracja GPU: CUDA i T-API

- [OpenCV — CUDA module overview](https://docs.opencv.org/4.x/d1/d1a/namespacecv_1_1cuda.html) — kind: article; `cv2.cuda` namespace, `GpuMat`, build prerequisites.
- [OpenCV — Transparent API (T-API) and `UMat` reference](https://docs.opencv.org/4.x/d2/d4d/tutorial_how_to_use_OpenCL.html) — kind: article; how `UMat` lets the same code dispatch to OpenCL / CPU.
- [NVIDIA CUDA Toolkit — official documentation](https://docs.nvidia.com/cuda/) — kind: article; the toolkit OpenCV's CUDA module is built against.

## OpenCV dnn i hybrydy z deep learningiem

- [OpenCV — DNN module overview](https://docs.opencv.org/4.x/d2/d58/tutorial_table_of_content_dnn.html) — kind: article; importing ONNX / Caffe / TensorFlow models, blob construction.
- [Redmon, J. and Farhadi, A. — *YOLOv3: An Incremental Improvement* (arXiv 2018)](https://arxiv.org/abs/1804.02767) — kind: paper; author: Joseph Redmon and Ali Farhadi; year: 2018; representative DNN model used as a comparison target.
- [ONNX — Open Neural Network Exchange specification](https://onnx.ai/onnx/intro/) — kind: article; the model-exchange format `cv2.dnn.readNetFromONNX` consumes.

## Czym są dane SAR i fizyka radaru

- [Synthetic-aperture radar — Wikipedia](https://en.wikipedia.org/wiki/Synthetic-aperture_radar) — kind: article; the side-looking-radar geometry and aperture-synthesis principle.
- [ESA Sentinel-1 SAR User Guide](https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar) — kind: article; ESA's official primer including imaging modes (SM, IW, EW, WV).
- [Moreira, A. et al. — *A Tutorial on Synthetic Aperture Radar* (IEEE Geoscience and Remote Sensing Magazine 2013)](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira, Pau Prats-Iraola, Marwan Younis, Gerhard Krieger, Irena Hajnsek and Konstantinos P. Papathanassiou; year: 2013; the canonical SAR tutorial paper.

## Polaryzacje, pasma i formaty SAR

- [ESA Sentinel-1 SAR — Acquisition modes and product types](https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar/acquisition-modes) — kind: article; SLC vs GRD, polarisation combinations.
- [Polarimetry — Wikipedia (radar polarimetry section)](https://en.wikipedia.org/wiki/Polarimetry#Radar_polarimetry) — kind: article; HH/HV/VV/VH and the scattering matrix.
- [Lee, J.-S. and Pottier, E. — *Polarimetric Radar Imaging: From Basics to Applications* (CRC Press, 2009)](https://doi.org/10.1201/9781420054989) — kind: book; author: Jong-Sen Lee and Eric Pottier; year: 2009; the polarimetric-SAR textbook.

## Wczytywanie SAR i konwersja do dB

- [`rasterio` documentation — Reading datasets](https://rasterio.readthedocs.io/en/latest/topics/reading.html) — kind: article; the canonical Python GeoTIFF reader for Sentinel-1 GRDs.
- [GDAL — official documentation](https://gdal.org/) — kind: article; the geospatial-data abstraction library `rasterio` builds on.
- [Decibel — Wikipedia](https://en.wikipedia.org/wiki/Decibel) — kind: article; the `10 · log10(x)` convention used to express SAR backscatter.

## Speckle i adaptacyjne filtry SAR

- [Lee, J.-S. — *Digital image enhancement and noise filtering by use of local statistics* (IEEE TPAMI 1980)](https://doi.org/10.1109/TPAMI.1980.4766994) — kind: paper; author: Jong-Sen Lee; year: 1980; the original Lee-filter paper.
- [Frost, V. S., Stiles, J. A., Shanmugan, K. S. and Holtzman, J. C. — *A Model for Radar Images and Its Application to Adaptive Digital Filtering of Multiplicative Noise* (IEEE TPAMI 1982)](https://doi.org/10.1109/TPAMI.1982.4767223) — kind: paper; author: Victor S. Frost, Josephine A. Stiles, K. Sam Shanmugan and Julian C. Holtzman; year: 1982; the Frost-filter paper.
- [Kuan, D. T., Sawchuk, A. A., Strand, T. C. and Chavel, P. — *Adaptive Noise Smoothing Filter for Images with Signal-Dependent Noise* (IEEE TPAMI 1985)](https://doi.org/10.1109/TPAMI.1985.4767641) — kind: paper; author: Darwin T. Kuan, Alexander A. Sawchuk, Timothy C. Strand and Pierre Chavel; year: 1985; the Kuan-filter paper.

## Korekcja geometryczna i ortorektyfikacja

- [ESA SNAP toolbox documentation](https://step.esa.int/main/toolboxes/snap/) — kind: article; the official ESA toolbox; defines the Range-Doppler Terrain Correction step OpenCV pipelines often delegate to before further processing.
- [Orthorectification — Wikipedia](https://en.wikipedia.org/wiki/Orthorectification) — kind: article; the DEM-based correction of terrain-induced distortion.
- [Small, D. — *Flattening Gamma: Radiometric Terrain Correction for SAR Imagery* (IEEE TGRS 2011)](https://doi.org/10.1109/TGRS.2011.2120616) — kind: paper; author: David Small; year: 2011; the radiometric-terrain-correction reference.

## Kalibracja radiometryczna do sigma0

- [Sentinel-1 — Radiometric calibration documentation](https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar/data-formats/radiometric-calibration) — kind: article; ESA's reference for the calibration LUT (sigma0, gamma0, beta0).
- [Synthetic-aperture radar — Wikipedia (radiometric calibration section)](https://en.wikipedia.org/wiki/Synthetic-aperture_radar#Calibration) — kind: article; concise summary of the calibration constants.
- [Miranda, N. and Meadows, P. J. — *Radiometric calibration of S-1 Level-1 products generated by the S-1 IPF* (ESA Technical Note 2015)](https://sentinels.copernicus.eu/documents/247904/685163/S1-Radiometric-Calibration-V1.0.pdf) — kind: paper; author: Nuno Miranda and Peter J. Meadows; year: 2015; the official ESA calibration technical note.

## Detekcja krawędzi w SAR: Canny vs ratio edge

- [Touzi, R., Lopes, A. and Bousquet, P. — *A Statistical and Geometrical Edge Detector for SAR Images* (IEEE TGRS 1988)](https://doi.org/10.1109/36.7665) — kind: paper; author: Ridha Touzi, Armand Lopes and Pierre Bousquet; year: 1988; the ratio-of-averages edge detector tailored to multiplicative noise.
- [Fjørtoft, R., Lopès, A., Marthon, P. and Cubero-Castan, E. — *An Optimal Multiedge Detector for SAR Image Segmentation* (IEEE TGRS 1998)](https://doi.org/10.1109/36.701008) — kind: paper; author: Roger Fjørtoft, Armand Lopès, Philippe Marthon and Eliseo Cubero-Castan; year: 1998; the multi-edge detector follow-up.
- [Canny, J. — *A Computational Approach to Edge Detection* (IEEE TPAMI 1986)](https://doi.org/10.1109/TPAMI.1986.4767851) — kind: paper; author: John Canny; year: 1986; the optical-image baseline being compared.

## Tekstury GLCM i cechy Haralicka

- [Haralick, R. M., Shanmugam, K. and Dinstein, I. — *Textural Features for Image Classification* (IEEE TSMC 1973)](https://doi.org/10.1109/TSMC.1973.4309314) — kind: paper; author: Robert M. Haralick, K. Shanmugam and Itshak Dinstein; year: 1973; the original 14-textural-features paper.
- [scikit-image — `graycomatrix` and `graycoprops` reference](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix) — kind: article; the canonical Python implementation used alongside OpenCV.
- [Co-occurrence matrix — Wikipedia](https://en.wikipedia.org/wiki/Co-occurrence_matrix) — kind: article; concise GLCM definition with example computations.

## CFAR — detekcja statków na SAR

- [Constant false alarm rate — Wikipedia](https://en.wikipedia.org/wiki/Constant_false_alarm_rate) — kind: article; CA-CFAR, OS-CFAR, GO/SO-CFAR variants summarised.
- [Crisp, D. J. — *The State-of-the-Art in Ship Detection in Synthetic Aperture Radar Imagery* (DSTO Technical Report DSTO-RR-0272, 2004)](https://apps.dtic.mil/sti/citations/ADA426096) — kind: paper; author: David J. Crisp; year: 2004; the canonical ship-detection survey, available from DTIC.
- [Greidanus, H., Alvarez, M., Santamaria, C., Thoorens, F.-X., Kourti, N. and Argentieri, P. — *The SUMO Ship Detector Algorithm for Satellite Radar Images* (Remote Sensing 2017)](https://doi.org/10.3390/rs9030246) — kind: paper; author: Harm Greidanus, Marlene Alvarez, Carlos Santamaria, François-Xavier Thoorens, Naouma Kourti and Pietro Argentieri; year: 2017; the JRC SUMO algorithm reference.

## Detekcja zmian SAR i mini-projekt powodzi

- [Rignot, E. J. M. and van Zyl, J. J. — *Change Detection Techniques for ERS-1 SAR Data* (IEEE TGRS 1993)](https://doi.org/10.1109/36.225529) — kind: paper; author: Eric J. M. Rignot and Jakob J. van Zyl; year: 1993; the log-ratio / mean-ratio change-detection paper.
- [Twele, A., Cao, W., Plank, S. and Martinis, S. — *Sentinel-1-based flood mapping: a fully automated processing chain* (International Journal of Remote Sensing 2016)](https://doi.org/10.1080/01431161.2016.1192304) — kind: paper; author: André Twele, Wenxi Cao, Simon Plank and Sandro Martinis; year: 2016; the DLR automated flood-mapping pipeline reference.
- [UN-SPIDER — *Recommended practice: Flood mapping with Sentinel-1*](https://www.un-spider.org/advisory-support/recommended-practices/recommended-practice-google-earth-engine-flood-mapping/in-detail) — kind: article; step-by-step practitioner recipe (thresholds, water mask, refinement) suitable for the mini-project.

# Sources: SAR dla inżyniera AI: od fizyki radaru do produkcyjnego ATR w PyTorch

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [Synthetic Aperture Radar Polarimetry](https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_4_DonaldEvans.pdf) — kind: book; author: Jakob van Zyl and Yunjin Kim; year: 2011; NASA/JPL monograph that covers SAR fundamentals, polarimetry, and decomposition methods used across Modules 1–2.
- [Microwave Remote Sensing: Active and Passive, Vol. II — Radar Remote Sensing and Surface Scattering](https://www.artechhouse.com/Main/Books/Microwave-Remote-Sensing-Active-and-Passive-Volume-2300.aspx) — kind: book; author: Fawwaz T. Ulaby, Richard K. Moore, Adrian K. Fung; year: 1986; canonical reference for radar imaging physics, scattering, and speckle statistics.
- [ESA Sentinel-1 SAR User Guide](https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-1-sar) — kind: article; official ESA reference for Sentinel-1 product types (SLC, GRD, OCN), polarisations, and processing levels.
- [Alaska Satellite Facility (ASF) — Sentinel-1 data search and tutorials](https://asf.alaska.edu/datasets/daac/sentinel-1/) — kind: article; primary download portal and tutorial set for Sentinel-1 from outside Europe.
- [SNAP — ESA's Sentinel Application Platform documentation](https://step.esa.int/main/toolboxes/snap/) — kind: article; official documentation for SNAP and the `snappy` Python bridge; covers calibration, terrain correction, speckle filtering operators.
- [PyTorch documentation](https://pytorch.org/docs/stable/index.html) — kind: article; the framework reference used for every Module 3 lesson.
- [scikit-image documentation](https://scikit-image.org/docs/stable/) — kind: article; canonical Python reference for GLCM, LBP, and morphology operators used in Module 2.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; convolution, U-Net, detection backbone background that underlies Module 3 architectures.
- [SAR Image Processing Algorithms (overview)](https://earth.esa.int/eogateway/documents/20142/37627/Sentinel-1-Product-Definition.pdf) — kind: article; ESA Sentinel-1 product definition document — reference for SLC/GRD precise definitions and metadata.

---

## Fizyka SAR, geometria i produkty Sentinel-1

- [Synthetic-aperture radar — Wikipedia](https://en.wikipedia.org/wiki/Synthetic-aperture_radar) — kind: article; comprehensive overview of SAR principles including range/azimuth, look angle, and product modes — the most efficient first-pass orientation.
- [ESA — Sentinel-1 SAR Definitions and Geometry](https://sentinels.copernicus.eu/web/sentinel/technical-guides/sentinel-1-sar/sar-instrument) — kind: article; official ESA description of the Sentinel-1 SAR instrument, modes (IW, EW, SM, WV), and acquisition geometry.
- [Sentinel-1 Product Definition (ESA, 2016, rev. 3.7)](https://sentinels.copernicus.eu/documents/247904/1877131/Sentinel-1-Product-Definition.pdf) — kind: article; canonical ESA reference defining SLC, GRD, OCN products with metadata layout — used for product-format comparisons.
- [Copernicus Sentinel-1: radar vision for Copernicus (ESA YouTube)](https://www.youtube.com/watch?v=WKsPRRmyFWw) — kind: video; official ESA primer (Nov 2024) on Sentinel-1 mission, SAR all-weather imaging, and radar geometry intuition; anchor video for the lesson.
- [van Zyl — Synthetic Aperture Radar Polarimetry (Ch. 1, "Basic principles of synthetic aperture radar")](https://descanso.jpl.nasa.gov/monograph/series2/Descanso2_4_DonaldEvans.pdf) — kind: book; author: Jakob van Zyl and Yunjin Kim; year: 2011; chapter introducing range, azimuth, chirp, and aperture synthesis with worked numerical examples.

## Speckle: statystyki i filtry adaptacyjne (Lee, Frost, Refined Lee, NL-means)

- [Speckle (interference) — Wikipedia](https://en.wikipedia.org/wiki/Speckle_(interference)) — kind: article; foundational entry on coherent-imaging speckle, multiplicative noise model and intensity statistics.
- [Lee, J.-S. — *Digital Image Enhancement and Noise Filtering by Use of Local Statistics*](https://doi.org/10.1109/TPAMI.1980.4767017) — kind: paper; author: Jong-Sen Lee; year: 1980; original Lee-filter paper — the historical basis for adaptive SAR filters.
- [Frost, V. S. et al. — *A Model for Radar Images and Its Application to Adaptive Digital Filtering of Multiplicative Noise*](https://doi.org/10.1109/TPAMI.1982.4767223) — kind: paper; author: Victor S. Frost, Josephine Abbott Stiles, K. Sam Shanmugan, Julian C. Holtzman; year: 1982; the original Frost-filter paper.
- [Yu, Y. and Acton, S. T. — *Speckle Reducing Anisotropic Diffusion*](https://doi.org/10.1109/TIP.2002.804276) — kind: paper; author: Yongjian Yu and Scott T. Acton; year: 2002; reference SRAD baseline often compared against Refined Lee.
- [scikit-image — `denoise_nl_means` reference](https://scikit-image.org/docs/stable/api/skimage.restoration.html#skimage.restoration.denoise_nl_means) — kind: article; official API for the NL-means filter the lesson uses against Lee/Frost.
- [ESA — Tutorial: SAR Speckle Filtering in SNAP](https://step.esa.int/main/wp-content/help/versions/9.0.0/snap-toolboxes/org.esa.s1tbx.s1tbx.op.sar.tools.ui/operators/SpeckleFilterOp.html) — kind: article; SNAP's official documentation covering Lee, Frost, Refined Lee, IDAN, and Lee Sigma filters.

## Pobieranie scen i kalibracja: ASF, snappy, xarray-sentinel, sigma0

- [`asf_search` — ASF Python API documentation](https://docs.asf.alaska.edu/asf_search/basics/) — kind: article; official user guide for the ASF Python search/download client used in the lesson's main workflow.
- [`sentinelsat` — documentation](https://sentinelsat.readthedocs.io/en/stable/) — kind: article; official Copernicus / ESA Open Hub Python client; the alternative download path covered in the lesson.
- [`xarray-sentinel` — official documentation](https://xarray-sentinel.readthedocs.io/en/stable/) — kind: article; the xarray-native reader for Sentinel-1 SLC / GRD that the lesson uses to index metadata without SNAP.
- [SNAP — Sentinel-1 Calibration operator (Calibration to sigma0/beta0/gamma0)](https://step.esa.int/main/wp-content/help/versions/9.0.0/snap-toolboxes/org.esa.s1tbx.s1tbx.op.calibration.ui/operators/CalibrationOp.html) — kind: article; canonical reference for radiometric calibration to σ⁰ used in the lesson.
- [`snappy` — ESA STEP documentation (Configure Python to use the SNAP-Python `snappy` interface)](https://senbox.atlassian.net/wiki/spaces/SNAP/pages/50855941/Configure+Python+to+use+the+SNAP-Python+snappy+interface) — kind: article; the official "how to drive SNAP from Python" reference.
- [Sentinel-1 — Radiometric Calibration of Level-1 Products (technical note)](https://sentinels.copernicus.eu/documents/247904/685163/S1-Radiometric-Calibration-V1.0.pdf) — kind: article; ESA technical note that defines the calibration LUT and σ⁰ formula the snappy operator implements.

## Terrain correction i geokodowanie scen Sentinel-1

- [Range-Doppler terrain correction — SNAP help](https://step.esa.int/main/wp-content/help/versions/9.0.0/snap-toolboxes/org.esa.s1tbx.s1tbx.op.sar.tools.ui/operators/RangeDopplerGeocodingOp.html) — kind: article; official operator documentation for the algorithm the lesson uses.
- [Schreier, G. (ed.) — *SAR Geocoding: Data and Systems*](https://www.wichmann-verlag.de/en/buecher/buchreihen/sar-geocoding-data-and-systems-de.html) — kind: book; author: Gunter Schreier (editor); year: 1993; foundational reference covering radar-grid → map-grid transformations.
- [Small, D. — *Flattening Gamma: Radiometric Terrain Correction for SAR Imagery*](https://doi.org/10.1109/TGRS.2011.2120616) — kind: paper; author: David Small; year: 2011; the standard reference for radiometric terrain flattening (γ⁰_T) — beyond plain geocoding.
- [Copernicus DEM — official product description (ESA)](https://spacedata.copernicus.eu/collections/copernicus-digital-elevation-model) — kind: article; official Copernicus DEM specs — the recommended DEM for Sentinel-1 terrain correction.
- [SRTM — NASA JPL mission page](https://www2.jpl.nasa.gov/srtm/) — kind: article; the legacy DEM still used in many SNAP defaults; covered for backward compatibility.
- [`rasterio` documentation](https://rasterio.readthedocs.io/en/stable/) — kind: article; the Python raster IO library used to read the geocoded GeoTIFF output and overlay it on a basemap.

## GLCM, Haralick i LBP — tekstura jako cecha SAR

- [Haralick, R. M., Shanmugam, K., and Dinstein, I. — *Textural Features for Image Classification*](https://doi.org/10.1109/TSMC.1973.4309314) — kind: paper; author: Robert M. Haralick, K. Shanmugam, Its'hak Dinstein; year: 1973; the original GLCM / Haralick-features paper — non-negotiable primary source.
- [Ojala, T., Pietikäinen, M. and Mäenpää, T. — *Multiresolution Gray-Scale and Rotation Invariant Texture Classification with Local Binary Patterns*](https://doi.org/10.1109/TPAMI.2002.1017623) — kind: paper; author: Timo Ojala, Matti Pietikäinen, Topi Mäenpää; year: 2002; foundational LBP paper.
- [`skimage.feature.graycomatrix` — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix) — kind: article; official API reference for the GLCM computation used in the lesson.
- [`skimage.feature.local_binary_pattern` — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.local_binary_pattern) — kind: article; official API reference for LBP.
- [Anys, H. and He, D.-C. — *Evaluation of Textural and Multipolarization Radar Features for Crop Classification*](https://doi.org/10.1109/36.485122) — kind: paper; author: Hervé Anys, Dong-Chen He; year: 1995; a SAR-specific application of GLCM features that the lesson uses as a baseline reference.

## Detekcja statków klasycznym CFAR i morfologią

- [Constant false alarm rate — Wikipedia](https://en.wikipedia.org/wiki/Constant_false_alarm_rate) — kind: article; concise description of CA-CFAR, OS-CFAR, and the threshold-vs-Pfa relation.
- [Crisp, D. J. — *The State-of-the-Art in Ship Detection in Synthetic Aperture Radar Imagery* (DSTO-RR-0272)](https://apps.dtic.mil/sti/citations/ADA426096) — kind: paper; author: David J. Crisp; year: 2004; comprehensive technical report covering classical SAR ship-detection pipelines including CFAR.
- [Wang, C., Bi, F., Zhang, W. and Chen, L. — *An Intensity-Space Domain CFAR Method for Ship Detection in HR SAR Images*](https://doi.org/10.1109/LGRS.2017.2713462) — kind: paper; author: Chao Wang, Fukun Bi, Wenjie Zhang, Liang Chen; year: 2017; modern CFAR variant covered as an extension.
- [Mathematical morphology — Wikipedia](https://en.wikipedia.org/wiki/Mathematical_morphology) — kind: article; the morphology primer the lesson cites.
- [`scipy.ndimage` — morphology reference](https://docs.scipy.org/doc/scipy/reference/ndimage.html#morphology) — kind: article; official API for the binary morphology operations the lesson uses to clean CFAR detections.
- [OpenSARShip 2.0 dataset — official page](https://emwlab.fudan.edu.cn/resources/) — kind: article; the dataset the lesson uses for the supervised baseline comparison.

## Koherencja interferometryczna i change detection

- [Bamler, R. and Hartl, P. — *Synthetic Aperture Radar Interferometry*](https://doi.org/10.1088/0266-5611/14/4/001) — kind: paper; author: Richard Bamler, Philipp Hartl; year: 1998; landmark survey of InSAR — including coherence definition.
- [Touzi, R. et al. — *Coherence Estimation for SAR Imagery*](https://doi.org/10.1109/36.752212) — kind: paper; author: Ridha Touzi, Armand Lopes, Jérôme Bruniquel, Paris W. Vachon; year: 1999; the primary statistical reference for coherence estimation used in the lesson.
- [Rignot, E. and van Zyl, J. — *Change Detection Techniques for ERS-1 SAR Data*](https://doi.org/10.1109/36.297979) — kind: paper; author: Eric J. M. Rignot, Jakob J. van Zyl; year: 1993; the classical log-ratio change-detection paper.
- [Bovolo, F. and Bruzzone, L. — *A Theoretical Framework for Unsupervised Change Detection Based on Change Vector Analysis in the Polar Domain*](https://doi.org/10.1109/TGRS.2006.885408) — kind: paper; author: Francesca Bovolo, Lorenzo Bruzzone; year: 2007; foundational CVA reference.
- [SNAP — InSAR coherence operator documentation](https://step.esa.int/main/wp-content/help/versions/9.0.0/snap-toolboxes/org.esa.s1tbx.s1tbx.op.insar.ui/operators/CoherenceOp.html) — kind: article; official SNAP coherence-operator reference.
- [Copernicus EMS — Flood mapping with Sentinel-1 (rapid mapping examples)](https://emergency.copernicus.eu/mapping/list-of-components/EMSR) — kind: article; portfolio of operational flood-mapping cases that ground the lesson's mini-project.

## Despeckling z CNN: ID-CNN, SAR-DRN i Speckle2Void

- [Wang, P., Zhang, H. and Patel, V. M. — *SAR Image Despeckling Using a Convolutional Neural Network*](https://doi.org/10.1109/LSP.2017.2758203) — kind: paper; author: Puyang Wang, He Zhang, Vishal M. Patel; year: 2017; the original ID-CNN paper.
- [Zhang, Q., Yuan, Q., Li, J., Yang, Z. and Ma, X. — *Learning a Dilated Residual Network for SAR Image Despeckling* (SAR-DRN)](https://doi.org/10.3390/rs10020196) — kind: paper; author: Qiang Zhang, Qiangqiang Yuan, Jie Li, Zhen Yang, Xiaoshuang Ma; year: 2018; the SAR-DRN paper.
- [Molini, A. B., Valsesia, D., Fracastoro, G. and Magli, E. — *Speckle2Void: Deep Self-Supervised SAR Despeckling with Blind-Spot Convolutional Neural Networks*](https://doi.org/10.1109/TGRS.2021.3065461) — kind: paper; author: Andrea Bordone Molini, Diego Valsesia, Giulia Fracastoro, Enrico Magli; year: 2022; the Speckle2Void paper.
- [Krull, A., Buchholz, T.-O. and Jug, F. — *Noise2Void — Learning Denoising from Single Noisy Images*](https://doi.org/10.1109/CVPR.2019.00223) — kind: paper; author: Alexander Krull, Tim-Oliver Buchholz, Florian Jug; year: 2019; the blind-spot self-supervised technique Speckle2Void adapts.
- [Zhang, K., Zuo, W., Chen, Y., Meng, D., Zhang, L. — *Beyond a Gaussian Denoiser: Residual Learning of Deep CNN for Image Denoising* (DnCNN)](https://doi.org/10.1109/TIP.2017.2662206) — kind: paper; author: Kai Zhang, Wangmeng Zuo, Yunjin Chen, Deyu Meng, Lei Zhang; year: 2017; the residual-learning baseline that influenced ID-CNN and SAR-DRN.
- [PyTorch — `torch.nn.Conv2d` and convolutional building blocks](https://pytorch.org/docs/stable/nn.html#convolution-layers) — kind: article; official reference for the layers the despeckling architecture is built from.

## Segmentacja semantyczna na SEN12MS z transfer learningiem

- [Schmitt, M., Hughes, L. H., Qiu, C. and Zhu, X. X. — *SEN12MS — A Curated Dataset of Georeferenced Multi-Spectral Sentinel-1/2 Imagery for Deep Learning and Data Fusion*](https://doi.org/10.5194/isprs-annals-IV-2-W7-153-2019) — kind: paper; author: Michael Schmitt, Lloyd H. Hughes, Chunping Qiu, Xiao Xiang Zhu; year: 2019; the SEN12MS dataset paper.
- [Ronneberger, O., Fischer, P. and Brox, T. — *U-Net: Convolutional Networks for Biomedical Image Segmentation*](https://doi.org/10.1007/978-3-319-24574-4_28) — kind: paper; author: Olaf Ronneberger, Philipp Fischer, Thomas Brox; year: 2015; the U-Net paper.
- [SEN12MS dataset — TUM mediaTUM repository](https://mediatum.ub.tum.de/1474000) — kind: article; the canonical SEN12MS download portal with class definitions and label mappings.
- [Ghaffarian, S., Valente, J., van der Voort, M. and Tekinerdogan, B. — *Effect of Attention Mechanism in Deep Learning-Based Remote Sensing Image Processing: A Systematic Literature Review*](https://doi.org/10.3390/rs13152965) — kind: paper; author: Saman Ghaffarian, João Valente, Mariska van der Voort, Bedir Tekinerdogan; year: 2021; survey of attention modules used as drop-in U-Net upgrades for SAR/optical fusion.
- [Hughes, L. H., Schmitt, M., Mou, L., Wang, Y. and Zhu, X. X. — *Identifying Corresponding Patches in SAR and Optical Images with a Pseudo-Siamese CNN*](https://doi.org/10.1109/LGRS.2018.2799232) — kind: paper; author: Lloyd H. Hughes, Michael Schmitt, Lichao Mou, Yuanyuan Wang, Xiao Xiang Zhu; year: 2018; foundational SAR–optical fusion architecture reference.
- [`segmentation_models_pytorch` — official documentation](https://smp.readthedocs.io/en/latest/) — kind: article; the practical PyTorch library the lesson uses for U-Net + ImageNet-pretrained backbones.

## ATR statków i pojazdów: OpenSARShip i MSTAR w PyTorch

- [Huang, L., Liu, B., Li, B., Guo, W., Yu, W., Zhang, Z. and Yu, W. — *OpenSARShip: A Dataset Dedicated to Sentinel-1 Ship Interpretation*](https://doi.org/10.1109/JSTARS.2017.2755672) — kind: paper; author: Lanqing Huang, Bin Liu, Boying Li, Weiwei Guo, Wenhao Yu, Zenghui Zhang, Wenxian Yu; year: 2018; the OpenSARShip dataset paper.
- [Air Force Research Laboratory — *MSTAR Public Targets* (Sensor Data Management System)](https://www.sdms.afrl.af.mil/index.php?collection=mstar) — kind: article; official MSTAR distribution and dataset description — the canonical ATR benchmark.
- [Chen, S., Wang, H., Xu, F. and Jin, Y.-Q. — *Target Classification Using the Deep Convolutional Networks for SAR Images*](https://doi.org/10.1109/TGRS.2016.2551720) — kind: paper; author: Sizhe Chen, Haipeng Wang, Feng Xu, Ya-Qiu Jin; year: 2016; foundational deep-learning result on MSTAR (A-ConvNet).
- [Jocher, G. et al. — Ultralytics YOLOv8 documentation](https://docs.ultralytics.com/) — kind: article; official documentation for the detector the lesson fine-tunes on OpenSARShip.
- [Lin, T.-Y., Goyal, P., Girshick, R., He, K., Dollár, P. — *Focal Loss for Dense Object Detection*](https://doi.org/10.1109/ICCV.2017.324) — kind: paper; author: Tsung-Yi Lin, Priya Goyal, Ross Girshick, Kaiming He, Piotr Dollár; year: 2017; the focal-loss reference cited in the imbalance discussion.
- [Schwegmann, C. P., Kleynhans, W., Salmon, B. P., Mdakane, L. W., Meyer, R. G. V. — *Synthetic Aperture Radar Ship Detection Using Haar-like Features*](https://doi.org/10.1109/LGRS.2016.2531085) — kind: paper; author: Colin P. Schwegmann, Waldo Kleynhans, Brian P. Salmon, Lizwe W. Mdakane, Rory G. V. Meyer; year: 2016; classical baseline the deep detector is compared against.

## Optymalizacja inferencji: ONNX, mixed precision i ewaluacja domain-specific

- [PyTorch — `torch.onnx` documentation](https://pytorch.org/docs/stable/onnx.html) — kind: article; official PyTorch ONNX export reference covering opset versions and dynamic axes.
- [ONNX Runtime — Performance and quantisation tutorials](https://onnxruntime.ai/docs/performance/) — kind: article; the canonical reference for FP16 / INT8 quantisation paths and EP selection.
- [PyTorch — *Quantization* documentation](https://pytorch.org/docs/stable/quantization.html) — kind: article; official PyTorch reference for static / dynamic / QAT quantisation flows.
- [Micikevicius, P. et al. — *Mixed Precision Training*](https://arxiv.org/abs/1710.03740) — kind: paper; author: Paulius Micikevicius, Sharan Narang, Jonah Alben, Gregory Diamos, Erich Elsen, David Garcia, Boris Ginsburg, Michael Houston, Oleksii Kuchaiev, Ganesh Venkatesh, Hao Wu; year: 2018; the foundational FP16 mixed-precision paper.
- [COCO Detection Evaluation Protocol](https://cocodataset.org/#detection-eval) — kind: article; the standard mAP / IoU protocol the lesson re-uses for SAR ship detection.
- [Anastasi, V. and Le, T. and Bouvet, A. — *PSNR / ENL / EPI quality metrics for SAR despeckling — a critical review*](https://doi.org/10.3390/rs13091807) — kind: paper; author: Vincenzo Anastasi et al.; year: 2021; structured review of despeckling-evaluation metrics underlying the quality dashboard.

## Capstone: end-to-end pipeline ATR na scenie Sentinel-1

- [SATIM — official company site (Senior AI Specialist context)](https://satim.co/) — kind: article; the role-defining context the capstone maps back to.
- [`xarray-sentinel` — Sentinel-1 IO tutorial (official notebook)](https://xarray-sentinel.readthedocs.io/en/stable/notebooks/sentinel-1-tutorial.html) — kind: article; the official tutorial covering the IO + metadata path the capstone reuses.
- [Schmitt, M. and Zhu, X. X. — *Data Fusion and Remote Sensing — An Ever-Growing Relationship*](https://doi.org/10.1109/MGRS.2016.2561021) — kind: paper; author: Michael Schmitt, Xiao Xiang Zhu; year: 2016; framing reference for end-to-end remote-sensing pipelines.
- [Zhu, X. X., Tuia, D., Mou, L., Xia, G.-S., Zhang, L., Xu, F., Fraundorfer, F. — *Deep Learning in Remote Sensing: A Comprehensive Review and List of Resources*](https://doi.org/10.1109/MGRS.2017.2762307) — kind: paper; author: Xiao Xiang Zhu, Devis Tuia, Lichao Mou, Gui-Song Xia, Liangpei Zhang, Feng Xu, Friedrich Fraundorfer; year: 2017; the canonical roadmap reference linking SAR pre-processing, classical features, and deep learning into a single pipeline.
- [Sentinel-1 Toolbox (S1TBX) tutorials — ESA STEP](https://step.esa.int/main/doc/tutorials/) — kind: article; the official ESA tutorial archive for end-to-end S-1 workflows from raw scene to product.
- [ICEYE — public technical documentation and sample data](https://www.iceye.com/sar-data) — kind: article; commercial SAR sample data referenced in the capstone description.

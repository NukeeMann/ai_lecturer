# Sources: SAR dla inżyniera Computer Vision: od piksela echa do detektora statków i samolotów

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira, Pau Prats-Iraola, Marwan Younis, Gerhard Krieger, Irena Hajnsek, Konstantinos P. Papathanassiou; year: 2013; the single best-cited plain(ish)-language SAR tutorial — pixel meaning, geometry, polarimetry, applications. The backbone reference for the whole course.
- [The SAR Handbook: Comprehensive Methodologies for Forest Monitoring and Biomass Estimation](https://doi.org/10.25966/nr2c-s697) — kind: book; author: Africa Ixmucane Flores-Anderson, Kelsey E. Herndon, Rajesh Bahadur Thapa, Emil Cherrington (eds.), NASA SERVIR; year: 2019; free, applied, code-forward government handbook covering SAR basics, polarimetry, calibration and processing — physics kept light.
- [Sentinel-1 SAR User Guide](https://sentiwiki.copernicus.eu/web/s1-mission) — kind: article; official ESA/Copernicus documentation for the exact data (Sentinel-1 SLC/GRD, modes, polarisation) the course uses.
- [Understanding Synthetic Aperture Radar Images](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P1448.aspx) — kind: book; author: Chris Oliver, Shaun Quegan; year: 2004; canonical reference on SAR statistics, speckle, and detection (CFAR) — the go-to for the classical-processing modules.
- [Synthetic-aperture radar — Wikipedia](https://en.wikipedia.org/wiki/Synthetic-aperture_radar) — kind: article; stable, broad entry useful as a quick cross-reference across nearly every lesson.

## Radar to nie kamera: własne oświetlenie zamiast światła otoczenia

- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; §I–II frame SAR as an active, self-illuminating sensor and define backscatter — exactly the "pixel = echo, not colour" anchor.
- [Sentinel-1 Mission overview](https://sentiwiki.copernicus.eu/web/s1-mission) — kind: article; official ESA description of the C-band active radar, day/night/all-weather capability, and acquisition modes.
- [What is Synthetic Aperture Radar? — NASA Earthdata](https://www.earthdata.nasa.gov/learn/backgrounders/what-is-sar) — kind: article; concise government backgrounder contrasting active radar with passive optical sensing; ideal intuition-level reading.
- [Echoes in Space: Introduction to Radar Remote Sensing — EO College](https://eo-college.org/courses/echoes-in-space/) — kind: video; ESA-backed free course with short explainer videos on active radar vs optical — good for one embedded clip.

## Geometria sceny bez trygonometrii: range, azimuth, layover i shadow

- [The SAR Handbook (Ch. 2 — SAR basics and geometry)](https://doi.org/10.25966/nr2c-s697) — kind: book; author: NASA SERVIR (Flores-Anderson et al., eds.); year: 2019; image-led treatment of range/azimuth and geometric distortions with minimal trigonometry.
- [Geometric distortions in radar imagery (layover, foreshortening, shadow) — Natural Resources Canada Tutorial](https://natural-resources.canada.ca/maps-tools-publications/satellite-elevation-air-photos/tutorial-fundamentals-remote-sensing) — kind: article; long-standing government remote-sensing tutorial that explains side-looking geometry distortions with clear diagrams.
- [Synthetic-aperture radar — Wikipedia (§ Range and azimuth, § Distortions)](https://en.wikipedia.org/wiki/Synthetic-aperture_radar) — kind: article; stable reference for slant vs ground range and the layover/shadow definitions.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; the imaging-geometry section ties incidence angle to where objects land in the image.

## Amplituda, faza i speckle: ziarnistość, która NIE jest szumem gaussowskim

- [A Tutorial on Speckle Reduction in SAR Images](https://doi.org/10.1109/MGRS.2013.2277512) — kind: paper; author: Fabrizio Argenti, Alessandro Lapini, Tiziano Bianchi, Luciano Alparone; year: 2013; explains speckle as multiplicative coherent interference (not additive Gaussian) and defines ENL — the definitive "why speckle is different" source.
- [Speckle (interference) — Wikipedia](https://en.wikipedia.org/wiki/Speckle_pattern) — kind: article; foundational definition of coherent speckle, transferable from optics to radar.
- [Understanding Synthetic Aperture Radar Images (Ch. on speckle statistics)](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P1448.aspx) — kind: book; author: Chris Oliver, Shaun Quegan; year: 2004; rigorous-yet-readable account of amplitude/intensity statistics, multilooking and ENL.
- [Equivalent Number of Looks / multilooking — Sentinel-1 ESA docs](https://sentiwiki.copernicus.eu/web/s1-processing) — kind: article; official description of looks and multilooking in the Sentinel-1 processing chain.

## Despeckling w praktyce: Lee, Frost, Refined Lee i NL-means before/after

- [Digital Image Enhancement and Noise Filtering by Use of Local Statistics](https://doi.org/10.1109/TPAMI.1980.4766994) — kind: paper; author: Jong-Sen Lee; year: 1980; the original Lee filter — primary source for the most-used SAR despeckle filter.
- [A Model for Radar Images and Its Application to Adaptive Digital Filtering of Multiplicative Noise](https://doi.org/10.1109/TPAMI.1982.4767223) — kind: paper; author: Victor S. Frost, Josephine Abbott Stiles, K. S. Shanmugan, Julian C. Holtzman; year: 1982; the original Frost filter.
- [A Tutorial on Speckle Reduction in SAR Images](https://doi.org/10.1109/MGRS.2013.2277512) — kind: paper; author: Fabrizio Argenti et al.; year: 2013; surveys Lee/Refined-Lee/Frost/NL-means and the speckle-reduction-vs-edge-preservation trade-off with before/after intuition.
- [skimage.restoration.denoise_nl_means — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.restoration.html#skimage.restoration.denoise_nl_means) — kind: article; official API the runnable widget calls for the NL-means before/after demo.

## Polaryzacja i skala dB: cztery kanały zamiast RGB, kalibracja sigma0

- [Sentinel-1 Radiometric Calibration — ESA documentation](https://sentiwiki.copernicus.eu/web/s1-processing) — kind: article; official definition of sigma0/beta0/gamma0 and how digital numbers become calibrated backscatter.
- [Flattening Gamma: Radiometric Terrain Correction for SAR Imagery](https://doi.org/10.1109/TGRS.2011.2120616) — kind: paper; author: David Small; year: 2011; the reference for gamma0 / terrain-flattened backscatter and why incidence angle matters to pixel values.
- [Radar polarimetry — Wikipedia](https://en.wikipedia.org/wiki/Radar#Polarization) — kind: article; stable primer on H/V transmit-receive combinations underpinning the "four channels instead of RGB" framing.
- [A Tutorial on Synthetic Aperture Radar (§ Polarimetry)](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; explains what HH/HV/VV/VH physically encode (scattering mechanisms) so polarisation channels aren't mistaken for colour.

## Od sceny do kafelka: GRD, multilooking, geokodowanie i terrain correction

- [Sentinel-1 Level-1 GRD product specification — ESA documentation](https://sentiwiki.copernicus.eu/web/s1-products) — kind: article; official spec for GRD (detected, multilooked, ground-range) vs SLC products — defines the friendlier detection product.
- [SNAP — Sentinel Application Platform (ESA STEP)](https://step.esa.int/main/toolboxes/snap/) — kind: article; official tool/documentation for the calibration → multilook → terrain-correction chain shown as reference code (the heavy steps the widget does not run).
- [The SAR Handbook (Ch. 3 — SAR data processing)](https://doi.org/10.25966/nr2c-s697) — kind: book; author: NASA SERVIR (Flores-Anderson et al., eds.); year: 2019; step-by-step, "why each step" walkthrough of the preprocessing pipeline with code.
- [Flattening Gamma: Radiometric Terrain Correction for SAR Imagery](https://doi.org/10.1109/TGRS.2011.2120616) — kind: paper; author: David Small; year: 2011; grounds the geocoding/terrain-correction step the pipeline performs.

## CFAR krok po kroku: adaptacyjny próg, który wykrywa statki na morzu

- [Constant false alarm rate — Wikipedia](https://en.wikipedia.org/wiki/Constant_false_alarm_rate) — kind: article; clear definition of CA-CFAR, guard/training cells, and the Pfa-to-threshold relationship — the conceptual spine of the CFAR lab.
- [The State-of-the-Art in Ship Detection in Synthetic Aperture Radar Imagery](https://apps.dtic.mil/sti/citations/ADA426096) — kind: paper; author: David J. Crisp; year: 2004; DSTO government report — the definitive survey of CFAR ship detection (CA/OS/two-parameter CFAR, sea clutter, false alarms). Maps directly onto the SATIM product.
- [Understanding Synthetic Aperture Radar Images (Ch. on detection/CFAR)](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P1448.aspx) — kind: book; author: Chris Oliver, Shaun Quegan; year: 2004; the statistical foundation for setting a CFAR threshold from clutter mean/std.
- [A Tutorial on Synthetic Aperture Radar (§ ocean/ship applications)](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; situates ship-on-sea detection within SAR applications.

## Tekstura, morfologia i change detection jako feature engineering pod AI

- [Textural Features for Image Classification](https://doi.org/10.1109/TSMC.1973.4309314) — kind: paper; author: Robert M. Haralick, K. Shanmugam, Its'hak Dinstein; year: 1973; the original GLCM/Haralick texture features — primary source for the texture lab.
- [skimage.feature.graycomatrix / graycoprops — scikit-image documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix) — kind: article; official API the GLCM widget calls to compute contrast/homogeneity/energy/correlation.
- [Change Detection Techniques for ERS-1 SAR Data](https://doi.org/10.1109/36.225244) — kind: paper; author: Eric J. M. Rignot, Jakob J. van Zyl; year: 1993; foundational reference establishing the log-ratio (vs difference) operator for multiplicative-speckle SAR change detection.
- [Mathematical morphology — Wikipedia](https://en.wikipedia.org/wiki/Mathematical_morphology) — kind: article; stable reference for the erosion/dilation/opening operations used to clean CFAR masks.

## Detekcja statków i samolotów: CFAR jako pre-detektor + klasyfikator CNN

- [Automatic Target Recognition in Synthetic Aperture Radar Imagery: A State-of-the-Art Review](https://doi.org/10.1109/ACCESS.2016.2611492) — kind: paper; author: Khalid El-Darymli, Eric W. Gill, Peter McGuire, Desmond Power, Cecilia Moloney; year: 2016; comprehensive review of the detect→discriminate→classify ATR pipeline (incl. CFAR pre-screening + CNN), framing the SATIM-style architecture.
- [A SAR Dataset of Ship Detection for Deep Learning under Complex Backgrounds (SSDD)](https://doi.org/10.3390/rs11070765) — kind: paper; author: Tianwen Zhang, Xiaoling Zhang, et al.; year: 2019; the SSDD benchmark — reference dataset for ship detection on Sentinel-1-style imagery.
- [End-to-End Object Detection with Transformers (DETR)](https://arxiv.org/abs/2005.12872) — kind: paper; author: Nicolas Carion, Francisco Massa, Gabriel Synnaeve, Nicolas Usunier, Alexander Kirillov, Sergey Zagoruyko; year: 2020; primary source for the DETR detector the lesson contrasts/adapts to SAR.
- [You Only Look Once: Unified, Real-Time Object Detection (YOLO)](https://arxiv.org/abs/1506.02640) — kind: paper; author: Joseph Redmon, Santosh Divvala, Ross Girshick, Ali Farhadi; year: 2016; primary source for YOLO, the end-to-end detector adapted to SAR (and why RGB priors struggle).

## Transfer learning i augmentacja SAR: klasyfikacja celów na chipach

- [Target Classification Using the Deep Convolutional Networks for SAR Images (A-ConvNets)](https://doi.org/10.1109/TGRS.2016.2551720) — kind: paper; author: Sizhe Chen, Haipeng Wang, Feng Xu, Ya-Qiu Jin; year: 2016; the classic all-convolutional CNN benchmark on MSTAR chip classification.
- [OpenSARShip: A Dataset Dedicated to Sentinel-1 Ship Interpretation](https://doi.org/10.1109/JSTARS.2017.2755672) — kind: paper; author: Lanqing Huang, Boli Liu, Boyang Li, Weiwei Guo, Wenhao Yu, Zenghui Zhang, Wenxian Yu; year: 2018; the OpenSARShip dataset for Sentinel-1 ship chip classification — central to the chips lab.
- [MSTAR Extended Operating Conditions: A Tutorial](https://doi.org/10.1117/12.242059) — kind: paper; author: Eric R. Keydel, Shung Wu Lee, John T. Moore; year: 1996; primary description of the MSTAR vehicle ATR benchmark and its operating-condition variations (aspect/depression angle) that motivate SAR augmentation.
- [What, Where, and How to Transfer in SAR Target Recognition Based on Deep CNNs](https://doi.org/10.1109/TGRS.2019.2947634) — kind: paper; author: Zhongling Huang, Zongxu Pan, Bin Lei; year: 2020; directly addresses transfer learning into SAR — what optical-pretrained features transfer and what breaks.

## Metryki i odporność: mAP, F1 per klasa oraz model 'data-agnostic'

- [Microsoft COCO: Common Objects in Context](https://arxiv.org/abs/1405.0312) — kind: paper; author: Tsung-Yi Lin, Michael Maire, Serge Belongie, James Hays, Pietro Perona, Deva Ramanan, Piotr Dollár, C. Lawrence Zitnick; year: 2014; defines the IoU-based mAP evaluation protocol the lesson uses for detection metrics.
- [A Survey on Performance Metrics for Object-Detection Algorithms](https://doi.org/10.1109/IWSSIP48289.2020.9145130) — kind: paper; author: Rafael Padilla, Sergio L. Netto, Eduardo A. B. da Silva; year: 2020; clean, implementation-oriented walkthrough of precision/recall, IoU, F1 and AP/mAP.
- [ONNX Runtime documentation](https://onnxruntime.ai/docs/) — kind: article; official docs for exporting/running models efficiently — the near-real-time/ONNX production note.
- [Automatic Target Recognition in SAR Imagery: A State-of-the-Art Review (§ evaluation & robustness)](https://doi.org/10.1109/ACCESS.2016.2611492) — kind: paper; author: Khalid El-Darymli et al.; year: 2016; covers evaluation under varying operating conditions — the "data-agnostic" robustness framing across angle/season/satellite.

## Capstone: surowa scena SAR → detekcje statków/samolotów + raport

- [The State-of-the-Art in Ship Detection in Synthetic Aperture Radar Imagery](https://apps.dtic.mil/sti/citations/ADA426096) — kind: paper; author: David J. Crisp; year: 2004; the end-to-end CFAR ship-detection pipeline reference the capstone assembles.
- [A SAR Dataset of Ship Detection for Deep Learning under Complex Backgrounds (SSDD)](https://doi.org/10.3390/rs11070765) — kind: paper; author: Tianwen Zhang, Xiaoling Zhang, et al.; year: 2019; dataset and evaluation framing for the capstone's detection target.
- [The SAR Handbook (end-to-end processing workflow)](https://doi.org/10.25966/nr2c-s697) — kind: book; author: NASA SERVIR (Flores-Anderson et al., eds.); year: 2019; the scene→tile→analysis workflow the capstone mirrors, with reference code.
- [Copernicus Data Space Ecosystem — Sentinel-1 data access documentation](https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel1.html) — kind: article; official docs for sourcing the raw Sentinel-1 scene the capstone starts from.

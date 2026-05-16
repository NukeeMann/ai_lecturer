# Sources: Optyka vs SAR — Porównawcza Wizja Komputerowa

> Working bibliography for course generation. Each entry must conform to
> `SourceSchema` (`src/lib/schemas/lesson.ts`) when copied into a lesson:
>   { url, title, kind: "paper" | "video" | "article" | "book", author?, year? }
> Prefer DOI / arxiv / Wikipedia / official docs / official YouTube channels.
> Avoid medium.com, towardsdatascience.com, dev.to, personal blogs.

## Course-wide references

- [Understanding Synthetic Aperture Radar Images](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P285.aspx) — kind: book; author: Chris Oliver and Shaun Quegan; year: 2004; klasyczny podręcznik SAR pokrywający tworzenie obrazu, statystyki speckle, filtrację, klasyfikację i interpretację — fundament całego kursu.
- [Polarimetric Radar Imaging: From Basics to Applications](https://www.routledge.com/Polarimetric-Radar-Imaging-From-Basics-to-Applications/Lee-Pottier/p/book/9781420054972) — kind: book; author: Jong-Sen Lee and Eric Pottier; year: 2009; biblia polarymetrii — używana w modułach 2 (HH/HV/VV/VH) i 7 (Pauli).
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; najczęściej cytowane wprowadzenie do SAR — pokrywa formację obrazu, polarymetrię, interferometrię w jednym czytelnym artykule.
- [Sentinel-1 User Guide (ESA)](https://sentiwiki.copernicus.eu/web/s1-mission) — kind: article; oficjalna dokumentacja misji Sentinel-1: produkty GRD/SLC, kalibracja, geometria, polaryzacja — referencyjne źródło dla każdej lekcji używającej kafelków Sentinel-1.
- [Computer Vision: Algorithms and Applications, 2nd ed. (online)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; darmowy online podręcznik CV — pokrywa stronę optyczną kursu (filtry, krawędzie, segmentacja, detekcja).
- [Digital Image Processing, 4th ed.](https://www.pearson.com/en-us/subject-catalog/p/digital-image-processing/P200000003224) — kind: book; author: Rafael C. Gonzalez and Richard E. Woods; year: 2018; klasyka image processing — punkt odniesienia dla filtrów liniowych, morfologii, FFT.
- [NASA Earthdata — What is SAR?](https://www.earthdata.nasa.gov/learn/backgrounders/what-is-sar) — kind: article; oficjalny, dostępny dydaktycznie przegląd SAR od NASA — dobry pierwszy materiał dla osób spoza teledetekcji.
- [ASF Data Recipes — SAR Basics](https://asf.alaska.edu/information/sar-information/what-is-sar/) — kind: article; Alaska Satellite Facility — przyjazne wprowadzenie do SAR z perspektywy operacyjnej i geometrycznej.

---

## Optyka vs SAR — dwa różne światy

- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcja 1 zawiera czytelne porównanie SAR vs sensory optyczne i przegląd misji.
- [What is SAR? (NASA Earthdata)](https://www.earthdata.nasa.gov/learn/backgrounders/what-is-sar) — kind: article; przedstawia różnice sensora pasywnego (optyka) i aktywnego (SAR) na poziomie intuicji, z grafikami.
- [Synthetic-aperture radar — Wikipedia](https://en.wikipedia.org/wiki/Synthetic-aperture_radar) — kind: article; punkt wejścia z linkami do wszystkich podtematów; szczególnie sekcja „SAR vs. optical sensing".
- [Sentinel-2 User Guide (ESA)](https://sentiwiki.copernicus.eu/web/s2-mission) — kind: article; oficjalna specyfikacja optycznego siostrzanego sensora Sentinel-2 — kontekst do par SEN12MS w kursie.

## Jak powstaje obraz SAR — apertura syntetyczna w intuicji

- [Digital Processing of Synthetic Aperture Radar Data](https://us.artechhouse.com/Digital-Processing-of-Synthetic-Aperture-Radar-Data-Algorithms-and-Implementation-P1037.aspx) — kind: book; author: Ian G. Cumming and Frank H. Wong; year: 2005; standardowy podręcznik przetwarzania sygnału SAR — rozdziały 2-3 to intuicyjne wprowadzenie do apertury syntetycznej.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcja 2 wyjaśnia syntezę apertury i rozdzielczość azymutalną z grafikami.
- [Synthetic Aperture Radar: Systems and Signal Processing](https://www.wiley.com/en-us/Synthetic+Aperture+Radar%3A+Systems+and+Signal+Processing-p-9780471857709) — kind: book; author: John C. Curlander and Robert N. McDonough; year: 1991; klasyczna referencja, szczególnie do range-Doppler i geometrii akwizycji.
- [MIT OpenCourseWare — Introduction to Radar Systems, Lecture 14 (SAR)](https://ocw.mit.edu/courses/res-ll-001-introduction-to-radar-systems-spring-2007/) — kind: video; wykład MIT z animacjami syntetycznej apertury — wartościowe wsparcie wizualne.

## Geometria SAR — foreshortening, layover, shadow

- [Sentinel-1 SAR Geometric Distortion (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-applications) — kind: article; oficjalny opis foreshortening / layover / shadow z grafikami i przykładami na produktach Sentinel-1.
- [ASF — SAR Image Geometry](https://asf.alaska.edu/information/sar-information/sar-image-geometry/) — kind: article; Alaska Satellite Facility — pedagogiczne wyjaśnienie deformacji geometrycznych z diagramami terenu.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcja 2.3 omawia geometrię SAR i artefakty terenu.
- [Synthetic-aperture radar — Wikipedia (Geometric distortion)](https://en.wikipedia.org/wiki/Synthetic-aperture_radar#Geometric_distortion) — kind: article; zwięzłe podsumowanie trzech typów deformacji geometrycznych.

## Speckle — dlaczego to nie jest szum gaussowski

- [Some fundamental properties of speckle](https://doi.org/10.1364/JOSA.66.001145) — kind: paper; author: Joseph W. Goodman; year: 1976; klasyczna praca wprowadzająca model speckle jako interferencji koherencyjnej — fundamentalna referencja.
- [A tutorial on speckle reduction in SAR images](https://doi.org/10.1109/MGRS.2013.2277512) — kind: paper; author: Fabrizio Argenti, Alessandro Lapini, Tiziano Bianchi, Luciano Alparone; year: 2013; tutorial przeglądowy — szczegółowy opis statystyki speckle, ENL, rozkładów Rayleigh/Gamma.
- [Speckle Filtering of Synthetic Aperture Radar Images: A Review](https://doi.org/10.1080/02757259409532206) — kind: paper; author: Jong-Sen Lee, Mitchell R. Grunes, Stephen A. Mango; year: 1994; przegląd metod filtracji speckle z perspektywy historycznej i operacyjnej.
- [Speckle (pattern) — Wikipedia](https://en.wikipedia.org/wiki/Speckle_pattern) — kind: article; ogólne wprowadzenie do speckle w obrazowaniu koherencyjnym (laser, ultrasound, SAR).

## Amplituda i faza — dane zespolone, których nie ma w optyce

- [Sentinel-1 SLC product specification (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-products) — kind: article; oficjalna specyfikacja produktu SLC (Single Look Complex) — co dokładnie zawiera amplituda i faza w jednym pikselu.
- [Digital Processing of Synthetic Aperture Radar Data](https://us.artechhouse.com/Digital-Processing-of-Synthetic-Aperture-Radar-Data-Algorithms-and-Implementation-P1037.aspx) — kind: book; author: Ian G. Cumming and Frank H. Wong; year: 2005; rozdział 4 — fizyczna interpretacja danych zespolonych SAR.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcja 3 zawiera intuicję phasor'a i interferometryczną ważność fazy.
- [numpy.fft documentation](https://numpy.org/doc/stable/reference/routines.fft.html) — kind: article; oficjalna dokumentacja FFT w numpy — bezpośrednie narzędzie do operacji na danych zespolonych w widgetach.

## Polarymetria — HH/HV/VV/VH zamiast RGB

- [A review of target decomposition theorems in radar polarimetry](https://doi.org/10.1109/36.485127) — kind: paper; author: Shane R. Cloude and Eric Pottier; year: 1996; klasyczny przegląd dekompozycji polarymetrycznych — podstawa modułu 7.2 (Pauli).
- [Polarimetric Radar Imaging: From Basics to Applications](https://www.routledge.com/Polarimetric-Radar-Imaging-From-Basics-to-Applications/Lee-Pottier/p/book/9781420054972) — kind: book; author: Jong-Sen Lee and Eric Pottier; year: 2009; rozdziały 2-3 — intuicyjne wprowadzenie do polaryzacji i mechanizmów rozpraszania.
- [Sentinel-1 Polarimetry overview (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-mission) — kind: article; jak Sentinel-1 zbiera VV/VH (oraz HH/HV w niektórych modach), z perspektywy operacyjnej.
- [Radar polarimetry — Wikipedia](https://en.wikipedia.org/wiki/Radar_polarimetry) — kind: article; lekkie wprowadzenie z dobrym objaśnieniem co znaczą HH/HV/VV/VH.

## Formaty danych SAR — GRD, SLC, kalibracja

- [Sentinel-1 Level-1 GRD product (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-products) — kind: article; oficjalna specyfikacja produktu Ground Range Detected — co znaczy przerzucenie na ground range.
- [Sentinel-1 Radiometric Calibration (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-applications) — kind: article; jak przeliczyć DN na sigma-nought / beta-nought / gamma-nought — niezbędne przed analizą.
- [ASF — Sentinel-1 Product Types](https://asf.alaska.edu/datasets/daac/sentinel-1/) — kind: article; pedagogiczny przegląd różnic między produktami Sentinel-1 (SLC, GRD, OCN).
- [Copernicus Data Space Ecosystem — Sentinel-1 documentation](https://documentation.dataspace.copernicus.eu/Data/SentinelMissions/Sentinel1.html) — kind: article; oficjalna dokumentacja repozytorium, z którego pobierane są kafelki dla kursu.

## Gauss, median, bilateral na optyce

- [Bilateral filtering for gray and color images](https://doi.org/10.1109/ICCV.1998.710815) — kind: paper; author: Carlo Tomasi and Roberto Manduchi; year: 1998; oryginalna praca o filtrze bilateralnym — must-cite dla tej lekcji.
- [scikit-image filters — official documentation](https://scikit-image.org/docs/stable/api/skimage.filters.html) — kind: article; oficjalne API filtrów liniowych i nieliniowych, których uczeń użyje w widgetach.
- [Computer Vision: Algorithms and Applications, 2nd ed. — Chapter 3 (Image processing)](https://szeliski.org/Book/) — kind: book; author: Richard Szeliski; year: 2022; rozdział o liniowym i nieliniowym filtrowaniu — bezpośrednie tło teoretyczne.
- [OpenCV — Image Smoothing tutorial](https://docs.opencv.org/4.x/d4/d13/tutorial_py_filtering.html) — kind: article; oficjalny tutorial OpenCV pokrywający Gauss/Median/Bilateral z przykładami w Pythonie.

## Dlaczego klasyczne filtry padają na SAR

- [Digital image enhancement and noise filtering by use of local statistics](https://doi.org/10.1109/TPAMI.1980.4766994) — kind: paper; author: Jong-Sen Lee; year: 1980; oryginalna praca Lee'a, w której argumentuje, dlaczego klasyczne filtry liniowe rozmywają krawędzie pod szumem mnożnym.
- [A tutorial on speckle reduction in SAR images](https://doi.org/10.1109/MGRS.2013.2277512) — kind: paper; author: Fabrizio Argenti et al.; year: 2013; sekcja 3 omawia limitacje filtrów liniowych na szumie mnożnym.
- [Speckle Filtering of Synthetic Aperture Radar Images: A Review](https://doi.org/10.1080/02757259409532206) — kind: paper; author: Jong-Sen Lee, Mitchell R. Grunes, Stephen A. Mango; year: 1994; ilustracje porównawcze klasycznych filtrów vs SAR-owych.
- [Understanding Synthetic Aperture Radar Images](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P285.aspx) — kind: book; author: Chris Oliver and Shaun Quegan; year: 2004; rozdział 5 — fundament „dlaczego linowe nie działa".

## Filtry SAR-owe — Lee, Frost, Refined Lee

- [Digital image enhancement and noise filtering by use of local statistics](https://doi.org/10.1109/TPAMI.1980.4766994) — kind: paper; author: Jong-Sen Lee; year: 1980; oryginalny filtr Lee'a — formuła wykorzystywana 1:1 w widgecie.
- [A model for radar images and its application to adaptive digital filtering of multiplicative noise](https://doi.org/10.1109/TPAMI.1982.4767223) — kind: paper; author: Victor S. Frost, Josephine Abbott Stiles, K. S. Shanmugan, Julian C. Holtzman; year: 1982; oryginalny filtr Frost'a.
- [Refined filtering of image noise using local statistics](https://doi.org/10.1016/S0146-664X(81)80018-4) — kind: paper; author: Jong-Sen Lee; year: 1981; warianty Lee z adaptacyjnymi podoknami — bezpośrednie tło dla Refined Lee.
- [Polarimetric SAR speckle filtering and its implication for classification](https://doi.org/10.1109/36.789635) — kind: paper; author: Jong-Sen Lee et al.; year: 1999; rozszerzenie Refined Lee na polarymetrię.

## Non-Local Means i nowoczesne despeckling

- [A non-local algorithm for image denoising](https://doi.org/10.1109/CVPR.2005.38) — kind: paper; author: Antoni Buades, Bartomeu Coll, Jean-Michel Morel; year: 2005; oryginalna praca NL-means — wprowadza ideę podobieństwa patch-patch.
- [Iterative weighted maximum likelihood denoising with probabilistic patch-based weights](https://doi.org/10.1109/TIP.2009.2028078) — kind: paper; author: Charles-Alban Deledalle, Loïc Denis, Florence Tupin; year: 2009; NL-SAR — adaptacja NL-means na statystykę SAR (PPB).
- [A nonlocal SAR image denoising algorithm based on LLMMSE wavelet shrinkage](https://doi.org/10.1109/TGRS.2011.2161586) — kind: paper; author: Sara Parrilli, Mariana Poderico, Cesario Vincenzo Angelino, Luisa Verdoliva; year: 2012; SAR-BM3D — adaptacja BM3D dla SAR.
- [skimage.restoration.denoise_nl_means — documentation](https://scikit-image.org/docs/stable/api/skimage.restoration.html#skimage.restoration.denoise_nl_means) — kind: article; oficjalna implementacja NL-means dostępna w Pyodide.

## Canny i Sobel na optyce vs SAR

- [A Computational Approach to Edge Detection](https://doi.org/10.1109/TPAMI.1986.4767851) — kind: paper; author: John Canny; year: 1986; oryginalna praca Canny'ego — niezbywalna referencja.
- [Sobel operator — Wikipedia](https://en.wikipedia.org/wiki/Sobel_operator) — kind: article; kanoniczne wyjaśnienie operatorów gradientowych Sobela i Prewitta.
- [OpenCV — Canny Edge Detection tutorial](https://docs.opencv.org/4.x/da/d22/tutorial_py_canny.html) — kind: article; oficjalny tutorial z parametrami, dokładnie w wersji którą wywoła widget.
- [skimage.feature.canny — documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.canny) — kind: article; alternatywna implementacja w scikit-image (dostępna w Pyodide).

## CFAR-edge i detektor Touziego

- [A statistical and geometrical edge detector for SAR images](https://doi.org/10.1109/36.3036) — kind: paper; author: Ridha Touzi, Armand Lopes, Pierre Bousquet; year: 1988; oryginalna praca o detektorze ratio-based — implementowany w widgecie 1:1.
- [An optimal multiedge detector for SAR image segmentation](https://doi.org/10.1109/36.673674) — kind: paper; author: Roger Fjørtoft, Armand Lopes, Patrick Marthon, Eliane Cubero-Castan; year: 1998; rozszerzenie idei na multi-edge i CFAR-edge.
- [Edge detection in radar images: A review](https://doi.org/10.1080/01431169408954018) — kind: paper; author: Roger Fjørtoft, Armand Lopes, Patrick Marthon; year: 1994; przeglądowa praca o detektorach krawędzi specyficznych dla SAR.
- [Understanding Synthetic Aperture Radar Images](https://us.artechhouse.com/Understanding-Synthetic-Aperture-Radar-Images-P285.aspx) — kind: book; author: Chris Oliver and Shaun Quegan; year: 2004; rozdział 7 — detekcja krawędzi i segmentacja SAR.

## Tekstura — GLCM, Haralick, LBP

- [Textural features for image classification](https://doi.org/10.1109/TSMC.1973.4309314) — kind: paper; author: Robert M. Haralick, K. Shanmugam, Its'hak Dinstein; year: 1973; oryginalna praca o GLCM i deskryptorach Haralicka.
- [Multiresolution gray-scale and rotation invariant texture classification with local binary patterns](https://doi.org/10.1109/TPAMI.2002.1017623) — kind: paper; author: Timo Ojala, Matti Pietikäinen, Topi Mäenpää; year: 2002; LBP w wersji rotation-invariant — używany na obu modalnościach.
- [Evaluation of textural and multipolarization radar features for crop classification](https://doi.org/10.1109/36.477189) — kind: paper; author: Hatem Anys, D.-C. He; year: 1995; jakie deskryptory tekstury przeżywają na SAR — bezpośrednia odpowiedź na pytanie lekcji.
- [skimage.feature.graycomatrix — documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.graycomatrix) — kind: article; oficjalna implementacja GLCM dostępna w Pyodide.

## Thresholding — Otsu vs CFAR

- [A threshold selection method from gray-level histograms](https://doi.org/10.1109/TSMC.1979.4310076) — kind: paper; author: Nobuyuki Otsu; year: 1979; oryginalna metoda Otsu.
- [The state-of-the-art in ship detection in SAR imagery](https://www.dst.defence.gov.au/publication/state-art-ship-detection-synthetic-aperture-radar-imagery) — kind: article; author: David J. Crisp; year: 2004; raport techniczny DSTO — kompletny przegląd CFAR i thresholding'u dla SAR.
- [Ship Surveillance with TerraSAR-X](https://doi.org/10.1109/TGRS.2010.2071879) — kind: paper; author: Susanne Brusch, Stephan Lehner, Thomas Fritz, Matteo Soccorsi, Adrian Soloviev, Bernd van Schie; year: 2011; aplikacja CFAR + Otsu na realnym pipeline'ie operacyjnym.
- [skimage.filters.threshold_otsu — documentation](https://scikit-image.org/docs/stable/api/skimage.filters.html#skimage.filters.threshold_otsu) — kind: article; oficjalna implementacja Otsu w Pyodide.

## Watershed, mean-shift, k-means na obu modalnościach

- [Mean shift: A robust approach toward feature space analysis](https://doi.org/10.1109/34.1000236) — kind: paper; author: Dorin Comaniciu and Peter Meer; year: 2002; kanoniczna praca o mean-shift segmentacji.
- [Least squares quantization in PCM](https://doi.org/10.1109/TIT.1982.1056489) — kind: paper; author: Stuart P. Lloyd; year: 1982; oryginalny algorytm k-means.
- [The Watershed Transformation Applied to Image Segmentation](https://link.springer.com/chapter/10.1007/978-3-642-87005-0_24) — kind: paper; author: Serge Beucher and Fernand Meyer; year: 1992; klasyka watershed.
- [scikit-learn — KMeans clustering documentation](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.KMeans.html) — kind: article; oficjalna implementacja k-means używana w widgecie.

## FFT — banded patterns w widmie SAR

- [Digital Processing of Synthetic Aperture Radar Data — Chapter 5](https://us.artechhouse.com/Digital-Processing-of-Synthetic-Aperture-Radar-Data-Algorithms-and-Implementation-P1037.aspx) — kind: book; author: Ian G. Cumming and Frank H. Wong; year: 2005; rozdział o przetwarzaniu range-Doppler — skąd biorą się banded patterns w widmie.
- [Fast Fourier transform — Wikipedia](https://en.wikipedia.org/wiki/Fast_Fourier_transform) — kind: article; ogólny przegląd FFT i konwencji.
- [numpy.fft documentation](https://numpy.org/doc/stable/reference/routines.fft.html) — kind: article; oficjalne API używane w widgecie do liczenia FFT 2D.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcja o processing chain wyjaśnia, dlaczego widmo SAR ma charakterystyczne pasma.

## Blob, MSER, klasyczna detekcja na optyce

- [Robust wide-baseline stereo from maximally stable extremal regions](https://doi.org/10.1016/S0262-8856(04)00021-4) — kind: paper; author: Jiří Matas, Ondřej Chum, Martin Urban, Tomáš Pajdla; year: 2004; oryginalna praca o MSER.
- [Feature detection with automatic scale selection](https://doi.org/10.1023/A:1008045108935) — kind: paper; author: Tony Lindeberg; year: 1998; klasyczna teoria multi-scale blob detection.
- [OpenCV — Blob Detection tutorial](https://docs.opencv.org/4.x/d0/d7a/classcv_1_1SimpleBlobDetector.html) — kind: article; oficjalny tutorial OpenCV SimpleBlobDetector.
- [skimage.feature.blob_log — documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.blob_log) — kind: article; LoG/DoG/DoH blob detection w scikit-image (Pyodide-friendly).

## CFAR — detekcja statków na morzu

- [The state-of-the-art in ship detection in SAR imagery](https://www.dst.defence.gov.au/publication/state-art-ship-detection-synthetic-aperture-radar-imagery) — kind: article; author: David J. Crisp; year: 2004; ~150 stron technicznego przeglądu — fundament tej lekcji.
- [Automatic detection of ships in Radarsat-1 SAR imagery](https://doi.org/10.1109/36.951095) — kind: paper; author: Christopher C. Wackerman, Karl S. Friedman, William G. Pichel, Pablo Clemente-Colón, Xiaofeng Li; year: 2001; klasyczny pipeline CFAR + post-processing.
- [Ship Surveillance with TerraSAR-X](https://doi.org/10.1109/TGRS.2010.2071879) — kind: paper; author: Susanne Brusch et al.; year: 2011; nowsza praca z operacyjną walidacją.
- [Sentinel-1 Maritime Monitoring (ESA)](https://sentiwiki.copernicus.eu/web/s1-applications) — kind: article; jak Sentinel-1 jest używany do monitoringu morskiego w produkcji.

## Detekcja pojazdów na lądzie

- [Performance of a high-resolution polarimetric SAR automatic target recognition system](https://www.ll.mit.edu/sites/default/files/page/doc/2018-05/11_1_1Novak.pdf) — kind: paper; author: Leslie M. Novak, Gregory J. Owirka, William S. Brower, Aaron L. Weaver; year: 1997; MIT Lincoln Lab — kanoniczny pipeline ATR z CFAR + dyskryminantem + klasyfikatorem.
- [SAR target recognition based on deep learning](https://doi.org/10.1109/TGRS.2016.2551720) — kind: paper; author: Sizhe Chen, Haipeng Wang, Feng Xu, Ya-Qiu Jin; year: 2016; nowoczesne podejście DL do klasyfikacji pojazdów na MSTAR — kontekst lekcji.
- [MSTAR Dataset overview (Sandia)](https://www.sdms.afrl.af.mil/index.php?collection=mstar) — kind: article; oficjalna strona zbioru chipów MSTAR z opisem klas, kątów i konwencji.
- [The state-of-the-art in ship detection in SAR imagery](https://www.dst.defence.gov.au/publication/state-art-ship-detection-synthetic-aperture-radar-imagery) — kind: article; author: David J. Crisp; year: 2004; rozdziały o detekcji na lądzie i clutter rejection.

## Change detection — optyka vs SAR

- [A detail-preserving scale-driven approach to change detection in multitemporal SAR images](https://doi.org/10.1109/TGRS.2005.858458) — kind: paper; author: Francesca Bovolo, Lorenzo Bruzzone; year: 2005; klasyczna praca o multi-scale log-ratio change detection.
- [Change detection techniques for ERS-1 SAR data](https://doi.org/10.1109/36.225528) — kind: paper; author: Eric J. M. Rignot, Jakob J. van Zyl; year: 1993; oryginalne porównanie difference vs ratio dla SAR.
- [Digital change detection techniques using remotely-sensed data](https://doi.org/10.1080/01431168908903939) — kind: paper; author: Ashbindu Singh; year: 1989; klasyczny przegląd technik change detection dla optyki.
- [A review of change detection in multitemporal SAR images](https://doi.org/10.1080/01431161.2018.1538590) — kind: paper; author: Yady Tatiana Solano-Correa, Francesca Bovolo, Lorenzo Bruzzone; year: 2019; nowoczesny przegląd — log-ratio, koherencja, deep learning.

## Koherencja interferometryczna jako sygnał zmiany

- [Synthetic aperture radar interferometry](https://doi.org/10.1088/0266-5611/14/4/001) — kind: paper; author: Richard Bamler, Philipp Hartl; year: 1998; przeglądowa praca o InSAR — fundament definicji koherencji.
- [Radar Interferometry: Data Interpretation and Error Analysis](https://link.springer.com/book/10.1007/0-306-47633-9) — kind: book; author: Ramon F. Hanssen; year: 2001; podręcznik InSAR — rozdział 3 o koherencji.
- [ESA InSAR Principles guide](https://www.esa.int/esapub/tm/tm19/TM-19_ptA.pdf) — kind: article; oficjalny ESA tutorial o interferometrii i koherencji z grafikami.
- [Coherence estimation for SAR imagery](https://doi.org/10.1109/36.752212) — kind: paper; author: Ronny Touzi, Armand Lopes, Jérôme Bruniquel, Paris W. Vachon; year: 1999; szczegółowa analiza estymacji koherencji.

## Faza interferometryczna — pomiar deformacji

- [The displacement field of the Landers earthquake mapped by radar interferometry](https://doi.org/10.1038/364138a0) — kind: paper; author: Didier Massonnet et al.; year: 1993; przełomowa praca o InSAR — pierwsze prążki Massonneta.
- [Synthetic aperture radar interferometry](https://doi.org/10.1088/0266-5611/14/4/001) — kind: paper; author: Richard Bamler, Philipp Hartl; year: 1998; teoretyczne podstawy interferometrii fazowej.
- [Radar Interferometry: Data Interpretation and Error Analysis](https://link.springer.com/book/10.1007/0-306-47633-9) — kind: book; author: Ramon F. Hanssen; year: 2001; rozdziały 4-5 — phase model i unwrapping.
- [ESA InSAR Principles guide](https://www.esa.int/esapub/tm/tm19/TM-19_ptA.pdf) — kind: article; zwięzłe, oficjalne wprowadzenie do interferometrii fazowej.

## Dekompozycja Pauli — pseudo-RGB dla SAR

- [A review of target decomposition theorems in radar polarimetry](https://doi.org/10.1109/36.485127) — kind: paper; author: Shane R. Cloude and Eric Pottier; year: 1996; teoretyczne podstawy dekompozycji Pauliego i Cloude-Pottiera.
- [Polarimetric Radar Imaging: From Basics to Applications — Chapter 7](https://www.routledge.com/Polarimetric-Radar-Imaging-From-Basics-to-Applications/Lee-Pottier/p/book/9781420054972) — kind: book; author: Jong-Sen Lee and Eric Pottier; year: 2009; intuicyjna prezentacja Pauli RGB i jego interpretacji.
- [Sentinel-1 polarimetry (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-applications) — kind: article; jak praktycznie wyliczyć Pauli na produktach Sentinel-1.
- [PolSARpro — ESA polarimetric SAR processor](https://earth.esa.int/eogateway/tools/polsarpro) — kind: article; oficjalne narzędzie ESA do polarymetrii z dokumentacją algorithmów.

## Jak trenuje się modele dla SAR — pipeline od A do Z

- [Deep learning in remote sensing: A comprehensive review and list of resources](https://doi.org/10.1109/MGRS.2017.2762307) — kind: paper; author: Xiao Xiang Zhu, Devis Tuia, Lichao Mou, Gui-Song Xia, Liangpei Zhang, Feng Xu, Friedrich Fraundorfer; year: 2017; szeroki przegląd DL w teledetekcji — fundament dla intuicji pipeline'u.
- [Deep learning in remote sensing applications: A meta-analysis and review](https://doi.org/10.1016/j.isprsjprs.2019.04.015) — kind: paper; author: Lei Ma, Yu Liu, Xueliang Zhang, Yuanxin Ye, Gaofei Yin, Brian Alan Johnson; year: 2019; meta-analiza praktyk treningowych w RS.
- [SEN12MS — A Curated Dataset of Georeferenced Multi-Spectral Sentinel-1/2 Imagery](https://arxiv.org/abs/1906.07789) — kind: paper; author: Michael Schmitt, Lloyd Haydn Hughes, Chunping Qiu, Xiao Xiang Zhu; year: 2019; arxiv preprint o zbiorze użytym w kursie.
- [PyTorch — Training a Classifier tutorial](https://pytorch.org/tutorials/beginner/blitz/cifar10_tutorial.html) — kind: article; oficjalny tutorial pokazujący pełny pipeline treningowy (referencyjny snippet w bloku Theory).

## Despeckling z ONNX — SAR-DRN w przeglądarce

- [Learning a Dilated Residual Network for SAR Image Despeckling](https://doi.org/10.3390/rs10020196) — kind: paper; author: Qiang Zhang, Qiangqiang Yuan, Jie Li, Zhen Yang, Xiaoshuang Ma; year: 2018; oryginalna praca o SAR-DRN — model uruchamiany w lekcji.
- [SAR image despeckling through convolutional neural networks](https://doi.org/10.1109/IGARSS.2017.8128234) — kind: paper; author: Giovanni Chierchia, Davide Cozzolino, Giovanni Poggi, Luisa Verdoliva; year: 2017; SAR-CNN — wcześniejsza alternatywa.
- [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/) — kind: article; oficjalna dokumentacja środowiska inferencji w przeglądarce.
- [SAR-DRN reference implementation (PyTorch)](https://github.com/qzhang95/SAR-DRN) — kind: article; oficjalne repo z wagami — z którego eksportujemy ONNX dla kursu.

## Klasyfikacja pojazdów MSTAR — ONNX inference

- [Target classification using the deep convolutional networks for SAR images](https://doi.org/10.1109/TGRS.2016.2551720) — kind: paper; author: Sizhe Chen, Haipeng Wang, Feng Xu, Ya-Qiu Jin; year: 2016; klasyczna praca CNN na MSTAR — baseline klasyfikatora.
- [MSTAR Dataset documentation (SDMS AFRL)](https://www.sdms.afrl.af.mil/index.php?collection=mstar) — kind: article; oficjalna strona zbioru z opisem klas, kątów i konwencji nazewnictwa.
- [Performance of a high-resolution polarimetric SAR automatic target recognition system](https://www.ll.mit.edu/sites/default/files/page/doc/2018-05/11_1_1Novak.pdf) — kind: paper; author: Leslie M. Novak et al.; year: 1997; historyczny baseline ATR sprzed ery deep learning.
- [ONNX Runtime Web documentation](https://onnxruntime.ai/docs/tutorials/web/) — kind: article; jak uruchomić inference w przeglądarce z wagami `.onnx`.

## Setup sceny — para Sentinel-1 + Sentinel-2 z SEN12MS

- [SEN12MS — A Curated Dataset of Georeferenced Multi-Spectral Sentinel-1/2 Imagery](https://arxiv.org/abs/1906.07789) — kind: paper; author: Michael Schmitt, Lloyd Haydn Hughes, Chunping Qiu, Xiao Xiang Zhu; year: 2019; arxiv preprint — pełna specyfikacja zbioru capstone'u.
- [Sentinel-1 User Guide (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-mission) — kind: article; jak pobrać i skalibrować kafelek S1.
- [Sentinel-2 User Guide (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s2-mission) — kind: article; jak pobrać i przeprocesować kafelek S2 (L1C/L2A).
- [Copernicus Data Space Ecosystem — Search and Download](https://documentation.dataspace.copernicus.eu/APIs/OData.html) — kind: article; oficjalne API repozytorium, którego używa agent generujący kurs do pobrania kafelków.

## Pipeline optyczny — detekcja statków

- [Ship Surveillance with TerraSAR-X — Section on optical baseline](https://doi.org/10.1109/TGRS.2010.2071879) — kind: paper; author: Susanne Brusch et al.; year: 2011; porównawcza referencja optyka vs SAR.
- [The state-of-the-art in ship detection in SAR imagery](https://www.dst.defence.gov.au/publication/state-art-ship-detection-synthetic-aperture-radar-imagery) — kind: article; author: David J. Crisp; year: 2004; rozdziały o klasycznym pipeline optycznym.
- [Sentinel-2 — Maritime applications (ESA)](https://sentiwiki.copernicus.eu/web/s2-applications) — kind: article; jak Sentinel-2 jest używany do detekcji statków operacyjnie.
- [skimage.feature.blob_log — documentation](https://scikit-image.org/docs/stable/api/skimage.feature.html#skimage.feature.blob_log) — kind: article; główne narzędzie pipeline'u optycznego — blob detection z LoG.

## Pipeline SAR — CFAR + morfologia + klasyfikator

- [Automatic detection of ships in Radarsat-1 SAR imagery](https://doi.org/10.1109/36.951095) — kind: paper; author: Christopher C. Wackerman et al.; year: 2001; klasyczny pipeline CFAR + morfologia + dyskryminant.
- [The state-of-the-art in ship detection in SAR imagery](https://www.dst.defence.gov.au/publication/state-art-ship-detection-synthetic-aperture-radar-imagery) — kind: article; author: David J. Crisp; year: 2004; obszerny opis każdego stage'u pipeline'u.
- [Ship Surveillance with TerraSAR-X](https://doi.org/10.1109/TGRS.2010.2071879) — kind: paper; author: Susanne Brusch et al.; year: 2011; nowoczesny pipeline z walidacją operacyjną.
- [Sentinel-1 Maritime Monitoring (ESA SentiWiki)](https://sentiwiki.copernicus.eu/web/s1-applications) — kind: article; oficjalna dokumentacja pipeline'u stosowanego w Sentinel-1.

## Synteza — kiedy radar, kiedy kamera, kiedy oba

- [Data fusion and remote sensing — An ever-growing relationship](https://doi.org/10.1109/MGRS.2016.2561021) — kind: paper; author: Michael Schmitt, Xiao Xiang Zhu; year: 2016; przegląd fuzji optyka+SAR — gdzie się uzupełniają.
- [Deep learning and process understanding for data-driven Earth system science](https://doi.org/10.1038/s41586-019-0912-1) — kind: paper; author: Markus Reichstein, Gustau Camps-Valls, Bjorn Stevens, Martin Jung, Joachim Denzler, Nuno Carvalhais, Prabhat; year: 2019; szersza perspektywa o łączeniu modalności w teledetekcji.
- [A Tutorial on Synthetic Aperture Radar](https://doi.org/10.1109/MGRS.2013.2248301) — kind: paper; author: Alberto Moreira et al.; year: 2013; sekcje końcowe o aplikacjach i komplementarności z optyką.
- [Multi-modal remote sensing image fusion: A comprehensive survey](https://doi.org/10.1016/j.inffus.2022.04.001) — kind: paper; author: Hao Zhang, Han Xu, Xin Tian, Junjun Jiang, Jiayi Ma; year: 2022; nowoczesny przegląd technik fuzji optyka+SAR.

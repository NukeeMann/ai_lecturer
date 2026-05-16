# Research: Optyka vs SAR — Porównawcza Wizja Komputerowa

## Topic summary

Kurs traktuje fundamentalną zmianę paradygmatu, której doświadcza inżynier wizji komputerowej przechodzący z obrazów optycznych na obrazy SAR (Synthetic Aperture Radar). Optyka to sensor pasywny rejestrujący odbite światło słoneczne w paśmie widzialnym/NIR — piksel niesie informację o albedo i barwie. SAR to sensor aktywny: anten boczna emituje mikrofalę (Sentinel-1 pracuje w paśmie C, ~5,4 GHz) i mierzy zespoloną odpowiedź echa, w której piksel zależy nie od koloru, lecz od chropowatości powierzchni, geometrii rozpraszania i właściwości dielektrycznych terenu. Konsekwencje są wszechobecne: szum jest multiplikatywny zamiast addytywnego, dane są zespolone (amplituda + faza), polaryzacja zastępuje RGB, a geometria jest „skośna" (range/azimuth zamiast pinhole'a).

Kurs jest komparatywny w każdej lekcji: ta sama klasyczna technika CV (Canny, Otsu, k-means, GLCM, MSER) uruchamiana jest najpierw na obrazie optycznym (Sentinel-2 lub klasyka jak cameraman), a potem na realnym kafelku SAR (Sentinel-1 GRD/SLC, MSTAR chip, para SEN12MS). Uczeń widzi naocznie, gdzie klasyka pada — fałszywe krawędzie na speckle, dyfuzja granic w Otsu na rozkładzie Gamma, GLCM zdominowane przez szum mnożny — i co trzeba podstawić, by tę samą funkcję spełnił operator SAR-owy (Lee/Frost/RefinedLee zamiast Gaussa, CFAR zamiast Otsu, Touzi zamiast Canny'ego).

Środowisko jest ściśle zdefiniowane: każda interaktywna część działa w Pyodide w przeglądarce. Dostępne są `numpy`, `scipy`, `opencv-python` (via micropip), `scikit-image`, `scikit-learn`, `matplotlib`, `onnxruntime-web`. **Niedostępne**: trening PyTorch/TensorFlow, SNAP/snappy, `sentinelsat`, GDAL. Inputy SAR/optyczne są dostarczane jako PNG/NPZ/JPG w `/inputs/` lekcji — żadnych pobrań sieciowych w czasie wykonania widgetu. Wszystkie kafelki Sentinel-1, MSTAR chipy i pary SEN12MS są przygotowywane przez agenta generującego (autoryzacja `$COPERNICUS_USER`/`$COPERNICUS_PASSWORD` do Copernicus Data Space Ecosystem) zawczasu.

Trzecia oś kursu to nowoczesny DL na SAR uruchamiany w przeglądarce przez `onnxruntime-web`: lekki despeckler (SAR-DRN / SAR-CNN) oraz klasyfikator chipów MSTAR. Bez treningu in-browser, ale z pełnym omówieniem pipeline'u treningowego offline (dane, augmentacje SAR-specyficzne, loss multiplikatywny, ewaluacja PSNR/ENL/accuracy-per-class). Capstone — para Sentinel-1 + Sentinel-2 portu morskiego — domyka kurs konfrontacją dwóch niezależnych pipeline'ów detekcji statków i syntetycznym raportem „kiedy radar, kiedy kamera, kiedy oba".

## Prerequisites

- 3+ lata pracy z klasyczną wizją komputerową w OpenCV / scikit-image / numpy (uczestnik ma to z autodeklaracji).
- Swoboda z konwolucją 2D, filtrami liniowymi i nieliniowymi (Gauss, median, bilateral), detekcją krawędzi (Sobel, Canny), morfologią matematyczną, segmentacją (Otsu, watershed, k-means).
- Numpy fluency: indeksowanie tablic, broadcasting, operacje wektoryzowane, FFT, statystyki lokalne.
- Bazowa statystyka: średnia, wariancja, histogram, rozkłady gaussowski/równomierny. **Nie zakładamy** swobody w rozkładach Rayleigh/Gamma/K — wprowadzamy je intuicyjnie.
- Bazowe liczby zespolone: `a + bi`, moduł, argument. Uczestnik woli intuicję wizualną nad formalizmem — wprowadzać phasor jako wektor na płaszczyźnie, nie jako element ciała.
- **Brak** wymagań co do SAR/teledetekcji/fizyki radaru. Zero wymagań co do SNAP/sentinelsat/GDAL — kurs ich nie używa.
- Brak wymagań co do treningu sieci neuronowych. Wystarczy zrozumienie inferencji (input → forward pass → output) na poziomie „użytkownika modelu w ONNX".

## Key concepts

### Akwizycja i geometria obrazowania
- **SAR (Synthetic Aperture Radar)**: aktywny sensor mikrofalowy łączący echa z wielu pozycji platformy w syntetyczną aperturę dla wysokiej rozdzielczości azymutalnej.
- **Range / Azimuth**: dwie osie obrazu SAR — odległość skośna do celu vs kierunek lotu satelity. Nie odpowiadają bezpośrednio kolumnom/wierszom obrazu optycznego.
- **Slant range vs ground range**: piksel surowy mierzy odległość skośną; produkt GRD jest przerzucony na płaszczyznę ziemi.
- **Look angle / incidence angle**: kąt nachylenia wiązki radaru względem nadiru / lokalnej normalnej powierzchni. Determinuje deformacje geometryczne.
- **Foreshortening / Layover / Shadow**: trzy typowe artefakty geometryczne SAR (skrócenie stoków zboczy zwróconych do radaru, zachodzenie szczytu na podstawę, cień radarowy za przeszkodą).

### Statystyka SAR
- **Speckle**: nie szum, ale interferencja w pełni rozwiniętego mowy elementarnych rozpraszaczy w komórce rozdzielczości — fundamentalna własność obrazowania koherencyjnego.
- **Szum multiplikatywny**: model `I = R · N`, gdzie `R` to prawdziwe odbicie, a `N` to losowy mnożnik (≈ 1, ale o znacznym CV).
- **Rozkład Rayleigh / Gamma**: amplituda jednowzorowego SAR ma rozkład Rayleigh; intensywność (kwadrat amplitudy) Exp; wielo-spojrzeniowa intensywność — Gamma o parametrze kształtu = ENL.
- **ENL (Equivalent Number of Looks)**: estymator efektywnej liczby uśrednień, mierzony jako `(μ/σ)²` na regionie jednorodnym. Kluczowa metryka jakości po despeckling'u.
- **Kontrast multiplikatywny vs addytywny**: SNR addytywny rośnie ze średnią, multiplikatywny od średniej nie zależy — to dlatego zwykłe odchylenie standardowe nie ma sensu dla SAR.

### Dane zespolone i polaryzacja
- **Amplituda + faza**: piksel SLC to liczba zespolona `z = A·e^(iφ)`. Optyka nie ma fazy.
- **SLC (Single Look Complex) vs GRD (Ground Range Detected)**: produkty Sentinel-1; SLC zachowuje fazę, GRD jest amplitudą rzutowaną na ziemię.
- **Kalibracja radiometryczna**: konwersja liczby cyfrowej (DN) na sigma-nought / beta-nought / gamma-nought (dB) — analog do white balance, niezbędny przed jakąkolwiek analizą.
- **Polaryzacja HH/HV/VV/VH**: kombinacja polaryzacji wysłanej i odebranej. Nie jest „kolorem" — koduje mechanizm rozpraszania (powierzchniowy, podwójny, wolumetryczny).
- **Dekompozycja Pauli**: trzy „kanały" tworzące pseudo-RGB SAR'u: `|HH-VV|` (double-bounce, np. budynki), `|HV+VH|` (volume, np. roślinność), `|HH+VV|` (surface, np. gładka woda/asfalt).

### Filtracja SAR
- **Filtr Lee**: lokalna MMSE estymata z modelu mnożnego — łączy obraz z lokalną średnią proporcjonalnie do lokalnego CV vs CV szumu.
- **Filtr Frost**: jądro o wagach eksponencjalnie malejących z odległością i lokalną wariancją.
- **Refined Lee**: Lee z adaptacyjnym wyborem podokna „rynnowego" wzdłuż lokalnych krawędzi — ratuje granice.
- **NL-means / SAR-BM3D**: filtracja non-local (podobieństwo patch-patch zamiast piksel-piksel); SAR-BM3D adaptuje BM3D do statystyki Gamma.

### Krawędzie i tekstury
- **Touzi edge detector**: ratio edge detector — porównuje stosunek średnich w dwóch sąsiednich półoknach (a nie różnicę, jak Canny) — stosunek jest CFAR w sensie statystyki mnożnej.
- **CFAR-edge**: rozszerzenie idei CFAR (target detector) na detekcję krawędzi.
- **GLCM (Gray-Level Co-occurrence Matrix)**: macierz częstości par pikseli w danej odległości i orientacji; z niej deskryptory Haralicka (contrast, energy, entropy, homogeneity).
- **LBP (Local Binary Pattern)**: deskryptor lokalnej tekstury jako 8-bitowy kod znaku różnic z sąsiadami.

### Detekcja, segmentacja, change detection
- **CFAR (Constant False Alarm Rate)**: adaptacyjny próg dla każdego piksela z estymatą tła z okna training, z guard window. Wersje: CA-CFAR (cell-averaging), OS-CFAR (order statistic), two-parameter CFAR.
- **Otsu**: optymalny próg minimalizujący wariancję wewnątrzklasową — dobrze działa dla bimodalnych histogramów Gaussa.
- **Log-ratio change detection**: dla SAR `Δ = log(I₁/I₂)`, w przeciwieństwie do różnicowego `Δ = I₁ - I₂` dla optyki. Logarytm zamienia szum mnożny na addytywny.
- **Koherencja interferometryczna**: `|γ| = |⟨z₁·z₂*⟩| / √(⟨|z₁|²⟩·⟨|z₂|²⟩)`. Stabilność fazowa między dwoma przejściami. Niezależne od amplitudy — niezastąpione w detekcji zmian struktury.

### InSAR
- **Faza interferometryczna**: `φ_int = φ₁ - φ₂` — różnica faz dwóch przelotów. Po usunięciu komponentu topograficznego zawiera komponent deformacyjny (mm-cm).
- **Interferogram**: obraz fazy interferometrycznej, modulo 2π — stąd „prążki" Massonneta.
- **Phase unwrapping**: rozwinięcie fazy z [-π, π] do ciągłej mapy deformacji (algorytmy Goldsteina, SNAPHU). W kursie sygnalizacyjnie — nie implementujemy pełnego unwrappingu.

### Deep Learning na SAR
- **SAR-DRN / SAR-CNN**: konwolucyjne despecklery uczone z parami clean/speckled (zwykle syntetycznie zaszumione optyczne obrazy lub multi-look-as-clean).
- **MSTAR**: publiczny dataset chipów X-band SAR (8 klas pojazdów wojskowych); de-facto benchmark klasyfikacji ATR.
- **SEN12MS**: dataset par Sentinel-1 + Sentinel-2 z etykietami land-cover; podstawa do data fusion i pretrain'u.
- **ONNX Runtime Web**: WebAssembly + WebGL backend; pozwala na inference w przeglądarce bez serwera GPU.

## Common misconceptions

- **„Speckle to po prostu hałas — uśrednię oknem i zniknie"** — uśrednianie linowe (Gauss) na szumie mnożnym zachowuje szum proporcjonalnie do sygnału i rozmywa krawędzie. Trzeba filtra adaptacyjnego (Lee/Frost) albo non-local (NL-means/BM3D).
- **„Filtr Gaussa jest uniwersalny"** — założenie szumu addytywnego gaussowskiego nie zachodzi na SAR; PSNR optycznych metryk daje fałszywe poczucie sukcesu na SAR.
- **„Otsu robi automatyczny threshold wszędzie"** — Otsu zakłada bimodalność Gaussa; rozkład Gamma SAR'u psuje to drastycznie, próg dryfuje wraz z ENL. Na SAR potrzebujemy CFAR.
- **„Canny zawsze daje czyste krawędzie"** — gradient zaszumionego mnożnie sygnału eksploduje na speckle; Canny generuje gęsty „dywan" krawędzi fałszywych. Detektory ratio-based (Touzi) są niezbędne.
- **„Faza SAR jest losowa, można ją wyrzucić"** — faza jednego obrazu jest niemal losowa, ale różnica faz dwóch obrazów tej samej sceny (interferogram) nosi informację deformacyjną milimetrowej skali.
- **„HH/HV/VV/VH to RGB radaru"** — to nie kanały koloru, lecz cztery sygnały zależne od mechanizmu rozpraszania. Wyświetlanie ich jako RGB jest **wizualizacją**, nie semantyką optyczną.
- **„Polarymetria pełna jest skomplikowaną fizyką, ominę"** — dekompozycja Pauli daje intuicyjny pseudo-kolor z trzech łatwych do obliczenia kombinacji, użyteczny od razu w wizualnej eksploracji.
- **„Piksel SAR to metr na ziemi"** — to slant range; ground range wymaga przeprojekcji o look angle. Bez tego rozkład wielkości obiektów jest błędny.
- **„MSTAR jest rozwiązany, klasyfikator MSTAR = klasyfikator SAR"** — chipy MSTAR są wycentrowane, jednorodnym tłem; realny ATR (Automatic Target Recognition) na full-scene SAR to inny, znacznie trudniejszy problem.
- **„log-ratio i difference dają to samo"** — różnicowe change detection działa dla szumu addytywnego, mnożnego psuje. Logarytm „prostuje" rozkład Gamma na bliski Gaussowi, dopiero wtedy operator różnicowy ma statystyczny sens.
- **„InSAR mierzy wysokość, nie zmianę"** — mierzy obie: komponent topograficzny (z geometrii baseline) i komponent deformacyjny (z różnicy czasu). Trzeba je rozseparować.
- **„Wystarczy uruchomić CFAR i mam statki"** — CFAR daje kandydatów; full pipeline wymaga morfologii (czyszczenie izolowanych pikseli), filtracji po rozmiarze, i — opcjonalnie — klasyfikatora discriminującego statki vs platformy/buoy.

## Suggested ordering

Ordering proponowane w `draftStructure` jest mocne — confirmuję je z drobnym uzasadnieniem dla każdego modułu:

1. **Fundamenty: skąd się bierze piksel SAR** — niezbywalnie pierwsze. Bez intuicji formowania obrazu, geometrii i statystyki speckle, wszystkie późniejsze „dlaczego klasyka pada" są niezrozumiałe.
2. **Dane SAR od środka** — po geometrii i statystyce naturalna jest struktura piksela: zespolony (faza/amplituda), wielopolaryzacyjny, format produktu. To wszystko, czego potrzebujemy zanim cokolwiek uruchomimy.
3. **Filtracja — klasyka kontra speckle** — pierwsza realna aplikacja CV. Konfrontacja Gaussa z Lee'em na tym samym kafelku ustala kanon „klasyka działa na optyce, SAR-specyficzne na SAR" — wzorzec, który kurs będzie powtarzał.
4. **Krawędzie i tekstury** — naturalne rozwinięcie filtracji (gradient → krawędź → lokalna statystyka → tekstura). Canny vs Touzi to drugie wielkie objawienie.
5. **Segmentacja i analiza spektralna** — łączy poprzednie umiejętności (statystyki lokalne + progowanie). FFT zamyka rozdział „klasyczna analiza obrazu".
6. **Detekcja obiektów i zmian** — pierwsza pełna aplikacja end-to-end (statki, pojazdy, change). To moment „kurs zaczyna być użyteczny".
7. **InSAR i polarymetria w praktyce** — moduł sygnalizacyjny zgodnie z odpowiedzią Q4 (InSAR jako jednorazowe wprowadzenie, nie pełny kurs interferometrii).
8. **Deep Learning na SAR w przeglądarce** — dopiero teraz, bo uczeń ma wszystkie statystyki SAR'owe potrzebne, żeby zrozumieć preprocessing (kalibracja, log-skala, znormalizowane ENL) i ewaluację (PSNR, ENL, per-class accuracy).
9. **Capstone — porównawcza analiza portu** — synteza wszystkich modułów na jednej parze SEN12MS. Idealne miejsce na intuicję „kiedy radar, kiedy kamera, kiedy oba".

Drobna sugestia dla `design_course` (do rozważenia, niezobowiązująca): lekcja 6.3 „Detekcja pojazdów na lądzie" mogłaby zostać przeniesiona po module 8 (jako wstęp do MSTAR), bo praktycznie wymaga klasyfikatora, nie tylko CFAR'u. Alternatywnie — pozostać w module 6 i wyraźnie zasygnalizować, że pełny pipeline pojazdów wraca w module 8 (preferowane: mniejsza migracja struktury, zgodne z user-spec).

## Notes for lesson generation

Reference: `docs/widgets.md`. Każda lekcja musi mieć **co najmniej jeden widget z dynamicznym outputem** (Code lub ParametricExplorer) zgodnie ze specem. Stosunek teorii do praktyki 0,59 — lekko teoria-leaning, więc Theory zawsze obecny, ale nie dominujący. User chce „15 min teorii + szybki widget / lub kilka widgetów", a przy szerszych tematach „2-3 bloki teorii z widgetami" — czyli wzorzec jest: krótki blok Theory → widget → ewentualnie kolejny krótki Theory → kolejny widget.

### KaTeX — gdzie matematyka pomaga, a nie przeszkadza
User zadeklarował „Nie lubie matematyki, [...] Wole realne przykłady. Wzór może być podany jak jest naprawde ważny, ale minimalistycznie." Tłumaczenie operacyjne: **jedno-dwa równania per lekcja maximum, każde z towarzyszącą intuicją wizualną**. Konkretnie:
- Speckle (1.4): `I = R · N` i PDF Rayleigh/Gamma — pokazane w widgecie ParametricExplorer rozkładu, nie w długim wywodzie.
- Amplituda+faza (2.1): `z = A·e^(iφ)` jako wektor na płaszczyźnie.
- Filtr Lee (3.3): formuła `b = max(0, (CV²-CN²)/CV²)` w jednej linii, towarzyszący widget z ENL slider.
- CFAR (6.2): próg `T = μ_bg + k·σ_bg` (lub adekwatny dla rozkładu Gamma), z widgetem ParametricExplorer dla `Pfa`.
- Interferometria (6.5, 7.1): `φ_int = φ₁ - φ₂` i `|γ| = ...` — w jednej linii, z ilustracją prążków na realnym interferogramie.
- Log-ratio (6.4): `Δ = log(I₁/I₂)` i krótka uwaga, dlaczego logarytm.
W pozostałych lekcjach: **bez wzorów**, jeśli można ten sam koncept oddać przez kod / wizualizację. NIE podajemy formuł kompletnych dla Frost'a, NL-means, GLCM Haralicka pełnego — to są niepotrzebne ściany matematyki dla tego uczestnika.

### Code widget (Pyodide) — wzorce kanoniczne
Środowisko: `numpy`, `scipy`, `opencv-python`, `scikit-image`, `scikit-learn`, `matplotlib`, `onnxruntime-web`. **NIE** dostępne w Pyodide: PyTorch/TF trening, snappy/SNAP, sentinelsat, GDAL — kod używający tych bibliotek umieszczamy wyłącznie jako **referencyjny snippet w bloku Theory** (z fenced code block), nigdy jako runnable Code widget.

Każdy Code widget musi mieć:
- `inputs`: realny kafelek SAR/optyczny z `/inputs/` (PNG dla wyświetlenia + opcjonalnie NPZ z surowymi danymi).
- `outputMedia`: docelowy obraz wynikowy (oczekiwany rezultat).
- `tests`: 2-4 testy z `assert`, hidden-with-peek (default).
- `solution`: pełna referencyjna implementacja.

Pyodide-friendly biblioteki dla typowych operacji:
- Filtry liniowe/nieliniowe: `scipy.ndimage` (gaussian, median, sobel, prewitt), `cv2.GaussianBlur`, `cv2.bilateralFilter`.
- Filtry adaptacyjne SAR: implementujemy własne w numpy (Lee, Frost) — to dokładnie *ten* moment dydaktyczny.
- Krawędzie: `cv2.Canny`, `skimage.feature.canny`, `skimage.filters.sobel`. Touzi/CFAR-edge — własne implementacje.
- Tekstura: `skimage.feature.graycomatrix` + `graycoprops`, `skimage.feature.local_binary_pattern`.
- Segmentacja: `skimage.filters.threshold_otsu`, `cv2.watershed`, `sklearn.cluster.KMeans`, `cv2.pyrMeanShiftFiltering`.
- FFT: `numpy.fft.fft2`, `np.fft.fftshift`.
- Blob/MSER: `cv2.SimpleBlobDetector`, `cv2.MSER_create`.
- ONNX inference: `onnxruntime-web` (sesja Wasm, input prep w numpy, output postproces).

### ParametricExplorer — gdzie slider naprawdę edukuje
- 1.4 Speckle: slider ENL → rozkład Rayleigh → Gamma (PDF + obraz syntetyczny).
- 3.1 Filtry liniowe: slider σ (Gauss), `d` (bilateral), rozmiar okna (median).
- 3.3 Filtry SAR: slider rozmiaru okna Lee/Frost; output: obraz po filtrowaniu + metryki PSNR/ENL.
- 6.2 CFAR ship detection: slidery `Pfa`, rozmiar guard, rozmiar training.
- 6.4 Change detection: slider progu na log-ratio map, slider okna sąsiedztwa.
- 7.1 InSAR phase: slider „baseline" do pokazania jak prążki gęstnieją.

### Sandbox — gdzie zachęta do eksperymentu zamyka lekcję
User w Q10 jasno zadeklarował chęć modyfikacji kodu. Sandbox na końcu lekcji „pojechać dalej": w lekcjach 3.3, 4.2, 5.1, 6.2 — wszędzie gdzie był Code z konkretnym zadaniem, Sandbox bez gradingu pozwala uczestnikowi spróbować np. innego rozmiaru okna lub własnej heurystyki postprocessingu.

### Demo
Tylko `gauss` jest zarejestrowany. Jedyna sensowna lekcja: 3.1 (Gauss/median/bilateral na optyce). W pozostałych — ParametricExplorer.

### PlotImage — gdzie statyczna figura bije interaktywność
- 1.2 Apertura syntetyczna: diagram geometryczny range/azimuth (statyczny, generowany matplotlibem).
- 1.3 Foreshortening/layover/shadow: trzy szkice geometryczne obok siebie.
- 2.2 Polarymetria: schemat HH/HV/VV/VH (TX/RX).
- 8.1 Trening DL: schemat pipeline'u (data → augmentation → model → loss → eval).

### Quiz — gdzie sprawdzić koncept przed dalej
Po każdej lekcji teoretycznej ciężkiej w pojęcia: 1.4 (speckle vs Gauss), 2.1 (faza), 2.2 (polaryzacja-to-nie-RGB), 5.1 (dlaczego Otsu pada), 6.5 (koherencja vs amplituda). Quizy konstruujemy z misconceptions z sekcji powyżej jako distraktorów.

### DataTable
Dwa naturalne zastosowania: 3.4 (porównanie filtrów despeckling: Lee/Frost/RefinedLee/NL-means/BM3D — kolumny: PSNR, ENL, complexity, kiedy stosować) i 4.3 (porównanie deskryptorów tekstury: GLCM/LBP/Gabor — kolumny: rotation-invariant?, multi-scale?, działa na SAR?).

### DragMatch
Ciekawe miejsce: 2.2 (zestaw HH/HV/VV/VH → mechanizmy rozpraszania: surface, double-bounce, volume, depolarized). Drugie: 1.3 (foreshortening / layover / shadow → trzy szkice terenowe).

### CodeCloze
Najlepsze tam, gdzie kod jest długi, ale dydaktycznie ważne są 2-3 konkretne linie. Np. 6.2 CFAR — pełna implementacja jako template, slot'y na próg, rozmiar guard, formuła T.

### Video
Sparingly. Maksymalnie 1-2 razy w kursie. Sensowne miejsca: 1.2 (aperture synthesis — istnieją świetne animacje na kanałach ESA / MIT OCW), 7.1 (InSAR — ESA ma serię „InSAR Principles"). Należy sprawdzić, czy embedują się przez `youtube` kind.

### Custom
Nie używamy — wszystkie potrzeby pokrywa registry.

### Treningowe vs niedostępne biblioteki — wzorzec na Theory
W lekcjach gdzie pokazujemy „jak to się robi offline" (8.1, 9.1, częściowo 8.2/8.3), kod treningowy PyTorch/Keras umieszczamy w fenced block w Theory:
````markdown
```python
# Referencyjny pipeline treningowy SAR-DRN (offline, NIE w Pyodide):
import torch
import torch.nn as nn
# ...
```
````
Z jasnym komentarzem „uruchamiane offline; w przeglądarce ładujemy gotowy .onnx".

### Inputy — przygotowanie kafelków
Środowisko wymaga, by **wszystkie** dane SAR/optyczne były pobrane przed runtime'em widgetu i dostępne jako `/courses/<slug>/assets/inputs/...`. Konkretne potrzeby per moduł:
- Sentinel-1 GRD wycinki VV + VH (paire 256×256 px, ≥ 3 sceny: port morski, miasto, teren rolniczy).
- Sentinel-1 SLC para tej samej sceny (do interferometrii i koherencji — 2 daty).
- MSTAR chipy (5-10 klas pojazdów, ~100 chipów każda) — publiczny dataset SDMS AFRL.
- SEN12MS pary (Sentinel-1 + Sentinel-2 tej samej sceny portowej, ≥ 1 patch dla capstone'u).
- Klasyczne obrazy optyczne do baseline (cameraman, Lena, lub equivalent — wystarczy `skimage.data`).
Agent generujący (`design_course` lub `generate_lesson`) zatroszczy się o pobranie i transkodowanie tych danych z Copernicus Data Space Ecosystem (auth przez `$COPERNICUS_USER` / `$COPERNICUS_PASSWORD`) i SDMS AFRL (MSTAR jest publiczny po rejestracji; chipy są dostępne też przez archiwum).

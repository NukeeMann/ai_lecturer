## Prerequisite Order

- `od-anchor-based-do-anchor-free-i-decoupled-head` relies on **IoU** ("przypisanie przez IoU", "kotwica o IoU z obiektem powyżej progu") with no definition, yet IoU is only formally introduced — formula `|A∩B|/|A∪B|` plus a full code exercise — two lessons later in `output-od-surowej-siatki-do-finalnych-detekcji`. Since the course chooses to teach IoU from scratch rather than assume it, either move a short IoU gloss earlier or add a forward-pointer in the anchor lesson.

- `trening-wasnego-detektora-na-lokalnym-gpu` asks the learner to choose a model variant from a **mAP@0.5:0.95** column ("Im większy model, tym wyższe mAP"), and `architektura-backbone-neck-head` already shows a "mAP 50-95" column, but the metric is only defined in `metryki-i-czytanie-krzywych-uczenia` (the next lesson). The learner acts on mAP before it is explained; a one-line "mAP wyjaśnimy w lekcji o metrykach" pointer in the training lesson would close the gap.

## Redundancy

- `format-datasetu-yolo-i-datayaml` and `adnotacja-i-konwersja-z-cocopascal-voc` both teach the VOC→YOLO conversion **and ship a near-identical `voc_to_yolo(box, img_w, img_h)` code exercise** with the same formula and worked example, neither acknowledging the other. Pick one lesson as the canonical implementation exercise and have the second cite it (e.g. apply it to a mini-batch) instead of re-deriving and re-implementing it.

- `architektura-backbone-neck-head` already explains **anchor-free** and **decoupled head** in its head section (including the objectness removal), and `od-anchor-based-do-anchor-free-i-decoupled-head` then re-explains both from scratch with no cross-reference. The second lesson does go deeper (k-means anchors, FCOS l/t/r/b, coupled-vs-decoupled), so a back-reference ("rozwinięcie tego, co zarysowaliśmy w architekturze") would frame it as a deepening rather than a repeat.

- `dlaczego-yolo-patrzy-tylko-raz` (`count_grid_predictions`) and `od-anchor-based-do-anchor-free-i-decoupled-head` (`count_predictions`) both contain a code exercise computing the **8400-candidate grid count** by summing `(input_size // stride)²` across scales — the second is just the first times `anchors_per_cell`. Consider having the anchor lesson extend the earlier function rather than restate the same grid arithmetic.

- The point that **modern YOLO has no separate objectness branch** (and that treating it as one is "częsty błąd") is made almost identically in `architektura-backbone-neck-head`, `output-od-surowej-siatki-do-finalnych-detekcji` and `funkcje-straty-i-label-assignment`, with no lesson signalling the others. Each context differs (head / decode / loss), but a single canonical statement plus brief recaps would avoid the triple repetition.

## Notation Consistency

- The definition of **confidence** is internally contradictory across the course. `detekcja-vs-klasyfikacja-vs-segmentacja` (`confidence = P(obiekt)·P(klasa|obiekt)`) and `inference-i-eksport-modelu` (`wynik (objectness × prawdopodobieństwo klasy)`) frame it via objectness, whereas `architektura-backbone-neck-head`, `output-od-surowej-siatki-do-finalnych-detekcji` and `funkcje-straty-i-label-assignment` explicitly state YOLO11 has **no objectness** and `confidence = σ(max_k z_k)` — and even call the objectness framing a common error. The YOLO11-specific lessons (esp. `inference-i-eksport-modelu`) should use the no-objectness definition, or the intro lesson should flag its formula as the classic/pre-YOLOv8 convention.

- The metric **mAP@0.5:0.95** is rendered inconsistently: `architektura-backbone-neck-head` labels its column "mAP 50-95", while `trening-wasnego-detektora-na-lokalnym-gpu` and `metryki-i-czytanie-krzywych-uczenia` use "mAP@0.5:0.95" (the latter also using "mAP50-95" for the `results.csv` field). The bare-text `results.csv` name is justified, but the table column headers should agree on one form (e.g. `mAP@0.5:0.95`) so a learner moving between lessons reads it as the same quantity.

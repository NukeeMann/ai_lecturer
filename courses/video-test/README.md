# video-test

Reference course for the Video widget. Four lessons cover the widget's main shapes:

| Lesson | Capability |
| --- | --- |
| `fourier-walkthrough` | Long manual transcript + theory wrapping |
| `mp4-demo` | Local MP4 playback through `/api/courses/[slug]/assets` |
| `neural-net-intro` | Captions-style transcript with speaker labels |
| `no-transcript` | Minimal embed — no title, no transcript, auto-fetch fallback |

## Regenerating `assets/sample.mp4`

The `assets/sample.mp4` file (~93 KB, 8 s, silent, 320×240) is a synthetic
test pattern produced by ffmpeg. Reproduce with:

```sh
ffmpeg -y -f lavfi -i "testsrc2=size=320x240:rate=15:duration=8" \
  -c:v libx264 -pix_fmt yuv420p -preset veryslow -crf 30 \
  -movflags +faststart -an \
  courses/video-test/assets/sample.mp4
```

`testsrc2` is an ffmpeg built-in colour test pattern (no external media), `-an`
drops the audio track, and `+faststart` moves the moov atom to the front so
the file plays back from the `/api/courses/[slug]/assets` route while still
streaming.

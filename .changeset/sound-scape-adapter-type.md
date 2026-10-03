---
"@zkmake/sound-scape": patch
---

Export `SoundscapeAdapter`, `SampleSource`, `DuckOptions` and `LoadOptions` from the main entry too, so a custom adapter (or `@zkmake/sound-mixer/scape`) can be typed against it without importing an adapter entry.

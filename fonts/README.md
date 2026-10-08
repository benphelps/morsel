# Fonts

Bitmap fonts (BDF) for text on the panel. `npm run fonts` compiles them into
`src/shared/fontdata.ts`, which the editor and the server both use; run it after
adding or changing a font here (and list the new one in `scripts/build-fonts.ts`).

| Font | Source | Licence |
| --- | --- | --- |
| TB-8, 5×8, 6×10, 6×13, 7×13 Bold, 9×15 Bold, 9×18 Bold, 10×20 | X11 misc-fixed, via [pixlet](https://github.com/tidbyt/pixlet/tree/main/fonts) | Public domain |
| Tom Thumb | Robey Pointer | MIT |
| CG Pixel 3×5, 4×5 | vyznev | © 2017 vyznev |
| Dina 6 | Jørgen Ibsen | MIT |
| Spleen 16, 24, 32 | [Frederic Cambus](https://github.com/fcambus/spleen) | BSD 2-Clause, [licenses/spleen-LICENSE.txt](licenses/spleen-LICENSE.txt) |
| Terminus Bold 16–32 | [Dimitar Zhekov](https://terminus-font.sourceforge.net) | SIL OFL 1.1, [licenses/terminus-OFL.txt](licenses/terminus-OFL.txt) |

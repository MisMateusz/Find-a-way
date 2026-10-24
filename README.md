# Labirynt dla dwojga: szablon

## Uruchomienie (jednorazowo)
```
npm create vite@latest labirynt -- --template vanilla-ts
cd labirynt
# skopiuj z tego szablonu: index.html, vite.config.ts, README.md, folder src/ i .github/ (nadpisz pliki)
npm install
npm run dev        # podgląd z odświeżaniem na żywo
npm run build      # buduje folder dist
```

## Gdzie co edytować
- `src/style.css`: kolory (zmienne na górze), czcionka, przyciski, układ ekranów.
- `index.html`: teksty i układ ekranów (home, lobby, mapper, explorer, result).
- `src/core/tiles.ts`: definicje kafelków. Nowy typ = jedna linijka w `TileType` i jedna w `TILE_DEFS`.
- `src/main.ts`: logika demo (losowa plansza, obracanie, ruch). Docelowo zastąpi ją sesja z siecią.

## Kafelki jako obrazki
W `tileEl()` (`src/main.ts`) zamień rysowanie CSS na `<img src="/tiles/${type}.png">` z
`style.transform = rotate(${rotation}deg)`, a obrazki wrzuć do `public/tiles/`.
W CSS dodaj `image-rendering: pixelated;`, żeby pixel art się nie rozmywał.

## Pasek `.dev`
Tymczasowy pasek na dole do przeskakiwania między ekranami. Usuń `<nav class="dev">` przed publikacją.

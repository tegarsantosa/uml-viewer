# UML Viewer

A single-page PlantUML viewer: write `@startuml` text on the left, see the diagram on the right, live.

Class diagrams are rendered natively in the browser in the style of IntelliJ's class diagram view: a kind badge per class (C, A, I, E…), an `m` / `f` icon per member, padlock visibility icons instead of `+ - # ~`, member names in blue with parameter types in grey, the field or return type right-aligned in its own column, the standard three compartments (name, attributes, operations) with empty ones kept unless `hide empty members` is set, static members underlined, abstract members in italics, auto layout, and orthogonal relationship lines with proper UML arrowheads.

Every other PlantUML diagram type (sequence, activity, state, use case, component, mind map, Gantt…) is rendered through a PlantUML server, so all PlantUML syntax keeps working.

## Run it

```bash
npm install
npm run dev
```

Then open the printed `localhost` URL. `npm run build` writes a static site to `dist/` that can be hosted anywhere.

### Tunnels and other hosts

The dev server accepts requests from ngrok, localtunnel, Cloudflare Tunnel, localhost.run and serveo domains out of the box, so `ngrok http 5173` just works. Other hosts go in `ALLOWED_HOSTS` (see `.env.example`), either in a `.env` file or on the command line:

```bash
ALLOWED_HOSTS="uml.mydomain.com,.example.org" npm run dev
```

A leading dot allows every subdomain, and `ALLOWED_HOSTS=all` disables the check. Set `HOST=true` to listen on all interfaces for LAN access.

## Interface

- **Editor** (left): CodeMirror with PlantUML highlighting, undo history and search. The text is kept in `localStorage`, so reloading keeps your work.
- **Diagram** (right): drag to pan, scroll or pinch to zoom, double-click to fit. The view stays where you left it while you type.
- **Renderer**: `Auto` picks the native renderer for class and object diagrams and the server for the rest. `Native` and `Server` force one or the other.
- **SVG / PNG**: downloads the current diagram. Native exports are self-contained SVG files with the theme colours baked in.
- **Link**: copies a URL with the diagram text compressed into the hash.
- **?** (bottom right of the diagram): legend for the visibility symbols.
- **Status bar**: which renderer was used, element counts, and any skipped lines. Click the skipped-lines button to jump to a line in the editor.

## Settings

| Group       | Option                      | Values                                         |
| ----------- | --------------------------- | ---------------------------------------------- |
| Appearance  | Theme                       | IntelliJ, Light, Dark, Darcula, Contrast, Sepia |
|             | Diagram font                | Sans-serif, Monospace                          |
|             | Font size                   | 10–20 px                                       |
| Layout      | Direction                   | From source, Top to bottom, Left to right      |
|             | Spacing                     | Compact, Normal, Relaxed                       |
|             | Edge style                  | Orthogonal, Straight, Curved                   |
|             | Jump over crossing lines    | on / off (hops where two lines cross)          |
| Members     | Visibility                  | Lock icons, Shapes, `+ − # ~`, Shapes and text |
|             | Member kind icon (m / f)    | on / off                                       |
|             | Parameters                  | Types only, Names only, As written, Hidden     |
|             | Show types                  | on / off                                       |
|             | Type position               | Right column, After name                       |
|             | Row dividers                | on / off                                       |
|             | Attributes / operations     | on / off (standard three-compartment notation) |
|             | Class kind badge            | on / off                                       |
|             | Stereotypes                 | on / off                                       |
| Server      | Server URL                  | any PlantUML server, default `plantuml.com`    |

Visibility icons: open green padlock = public, closed red padlock = private, yellow padlock with keyhole = protected, grey ring = package-private. In "Shapes" mode: green circle, red square, yellow diamond, blue triangle. The `?` button on the diagram shows the legend for the current mode.

## Supported class-diagram syntax (native renderer)

- `class`, `abstract class`, `abstract`, `interface`, `enum`, `annotation`, `entity`, `struct`, `exception`, `record`, `protocol`, `metaclass`, `object`
- `class "Display name" as Alias`, `class Alias as "Display name"`, generics `class Repo<T extends Entity>`
- Stereotypes `<<value object>>`, custom spots `<< (S,#FF7700) Singleton >>`, colours `#lightblue`
- `class A extends B implements C, D`
- Members inside `{ }` or as `Class : member`, with visibility `+ - # ~`, `{static}`, `{abstract}`, `{field}`, `{method}`, PlantUML style (`name: Type`) or Java style (`Type name`)
- Compartment separators `--`, `..`, `==`, `__`, optionally titled (`-- queries --`)
- Relations: `<|--` extension, `<|..` realisation, `*--` composition, `o--` aggregation, `-->` association, `..>` dependency, `--` link, plus `x`, `#`, `}`, `+`, `^` ends
- Association classes `(A, B) .. C`
- Cardinalities `"1" -- "*"`, labels `: label`, direction hints `-left->`, `-up->`, `-[hidden]-`, `-[#red,bold]->`, one-dash horizontal `->`
- `package`, `namespace`, `folder`, `frame`, `rectangle`, `together` groups, nested
- `note left/right/top/bottom of X`, floating notes with `..` links, `note on link`
- `title`, `caption`, `legend`, `left to right direction`, `hide empty members`, `hide circle`, `hide members/fields/methods`, `hide <<stereotype>>`, `hide X`, `remove X`, `skinparam linetype ortho|polyline`
- `'` line comments and `/' '/` block comments

Lines the native parser does not understand are skipped and listed in the status bar; nothing else breaks.

## Project layout

```
index.html         page shell
src/main.ts        app wiring: editor, pan/zoom, settings, export
src/parser.ts      PlantUML class-diagram parser → model
src/model.ts       diagram model types
src/render.ts      dagre layout + IntelliJ-style SVG rendering
src/detect.ts      guesses the diagram type to pick a renderer
src/remote.ts      PlantUML server URL encoding
src/editor.ts      CodeMirror setup and PlantUML highlighting
src/settings.ts    settings, themes and diagram palettes
src/examples.ts    example diagrams
src/style.css      UI styles and theme variables
```

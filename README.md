# Islandforge Studio

A React, Vite, and Three.js workspace for exploring and exporting the supplied coastal island as a stylized, game-ready coastal town map.

## Workspace

- Drag to orbit, right-drag to pan, and scroll to zoom.
- Use 3D View, Top View, and Compare to switch cameras.
- Select scene layers, control their visibility, or double-click a district to focus it.
- Explore Island enables free-flight navigation with WASD, Q/E for elevation, Shift for speed, and Escape to exit. This is a fly-through camera, not a gameplay collision controller.
- The ruler measures horizontal distances using the project's assumed game scale.
- Edit terrain elevation, building height, water level, material colors, and rendering options. Undo and redo are supported.
- Download a viewport PNG, a grouped GLB, geometry-only OBJ, or the complete coordinate trace as JSON.

## Location Grid And Coordinates
- The map is divided into 100 m cells, labelled A-J across (west to east) and 1-11 down (north to south). The minimap always shows this grid. A draped 3D overlay is available but off by default, because at terrain height it produced stray lines across roads, the port and slopes. When enabled it lies on the topmost surface (terrain, asphalt, or quay deck) rather than a fixed offset above the ground. Toggle it in the inspector ("Map grid (100 m)") or with G.
- Drive mode (toolbar car button or C) spawns a small block car you can drive with WASD/arrows, Space to brake, and Escape to exit. It follows the terrain (pitch and roll included), steers like an arcade car, and cannot climb into the sea. Bridge decks count as driveable surface, so the car can cross to Beach Island and the port. The chase camera trails behind the car.
- The minimap (top-right) shows the islands, roads, the grid with labels, the car indicator, and a highlight of the current cell. While in drive mode, click the minimap to teleport the car.
- Next to the minimap, a live readout shows the current cell and world coordinates. The copy button writes a copy-ready string such as `grid C4 · X +123 m · Z -456 m · image px (867, 64)` — paste it into a request to pinpoint an area for micro changes. Image pixels are the map's native coordinate system.
- The car, the 3D grid overlay, and the minimap are viewport aids and are excluded from model exports.

## Reference And Accuracy

`src/mapData.ts` contains a manual coordinate trace based on the map shown in the request. Its coordinate system is the original 1448 x 1086 image. It is not a procedural or randomized island.

The prompt attachment was visible as a reference but was not available as a local image asset. The default reference thumbnail is therefore explicitly labeled **Traced Guide**, not the original image. Exact pixel alignment has not been verified and should not be assumed.

To compare against the actual source, use **Link Original Image** with the uncropped 4:3 image. The source is locked to the same coordinate plane. Compare uses a north-aligned orthographic camera, disables the water grid and shadows, and provides an image-opacity slider. The review checklist records a user's manual inspection; it does not generate an automated accuracy score.

The imported source persists locally in IndexedDB. Scene settings and the project name persist in localStorage. No image or scene data is uploaded to a server.

Building footprints and heights are approximate massing interpretations, especially where labels obscure the source. The physical scale is an assumption of **1 image pixel = 1 meter**, since the reference provides no surveyed scale. Coastline and road nodes can be corrected in `src/mapData.ts` after source-image review.

## Geometry And Export

- Four separate landmasses: main island, engineered port island, eastern Beach Island, and Fort Island off the north-west shoulder in grid A1/A2. The port island is detached from the main terrain mesh and connected by bridge decks across the cut channel; Fort Island reaches the main island's coastal ring at (452,405) over a ~240 m causeway bridge.
- Fort Island follows the existing coastal language (soft juts and recesses at 20-40 px scale) rather than a geometric blob. It carries two districts: the **Old Fort** in A1, a bastioned octagonal rampart with four corner bastions, parade ground, keep and gate on a rocky cliff-backed promontory at the north; and the **Space Center** in A2, a level southern terrace with a circular launch pad and mount, service gantry with swing arm, vehicle assembly building, control centre and support block.
- The terrain domain is extended west and north (origin image 160,-100) and south (size 1080 x 1360) so Fort Island and the shoals keep full seabed shelves. Grid row 1 begins at image z = -30, so Fort Island's northern tip sits at a small negative image coordinate — inside the world, just above the source image.
- The **Eyer Shoals** are a natural cluster across grids A9/A10 off the south-west shoulder: **Great Eyer** (rocky NE headland, two coves and a long hooked sand spit), **Wader Bank** (a thin crescent sandbar at the tide line), **Palm Frill** (three lobes reaching east), **Granite Point** (a bare angular skerry), **Mangrove Fringe** (twin lobes joined by a low neck), plus three bare rock skerries on the reef. Each carries its own terrain character — cap height, foreshore run and rock weight — so none read as copies. Unlike the mainland's broad lagoon, islets get a tight reef shelf: the shallow band hugs the coast instead of blooming into a halo. No roads, paths or structures. Grid rows 9/10 begin at image z = 1050, so the shoals sit south of the source image, inside the world.
- Reference-coordinate road paths, bridge spans, pier connections, and port aprons.
- District-specific building forms (downtown mid-rise, north residential, port industrial, beach cottages) plus lighthouse headland.
- The four blocks hugging the downtown circle form a Central Park: one continuous lawn (42 m radius) with a promenade ring (42-46 m) and the fountain at its center, sized to clear the bounding streets (market-street, central-avenue, south-cross) with a margin of at least 5 m. The watchtower, fountain, and every surrounding street stay in place. The circle's internal radial paths are removed, along with the `plaza-north` and `gateway-west` road segments that used to cut across the merged plot; both roads still exist and connect normally outside the park.
- Elevated North Town / lighthouse terrain, port seawalls and quays, beach sand bands.
- Roads retain their traced centerlines and widths with automatic tangent-continuous corner rounding: polygonal SVG chords are filleted with smooth circular arcs (radius ~18m), eliminating angular kinks. Asphalt, curb, and sidewalk ribbons use circular arc joins on bends, and intersection envelopes feature rounded curb returns (radius 3.5-4.5m) so street corners are smooth curves. Asphalt sits 0.08 m above the graded corridor; sidewalks and curb tops sit 0.42 m above it (a 0.34 m step down). Curb inner faces form that riser; sidewalk outer faces drop to the ground. Bridges have decks, rails, and supports.
- No trees, vehicles, people, detailed facades, or decorative clutter.
- The exported origin corresponds to image coordinate (744, 520), with +Y up, +X east, and +Z south.
- GLB preserves node groups and material colors. OBJ is geometry-only.
- JSON preserves the trace in image pixels along with scene settings and alignment status.
- Overlays, district labels, measurement lines, lighting, and the viewport grid are excluded from model exports.
- Water is an opaque open-sea volume plus a depth-shaded surface around the islands. Its vertex colors come from the actual water depth over the seabed: foam at the waterline, turquoise shallows, then open-sea blue. It updates with the water level and elevation controls. It remains a replaceable placeholder, not a final water shader. The viewport uses no fog and neutral tone mapping. For export, the sea volume is trimmed and only visible water-surface cells are written.
- Terrain is one continuous heightfield from hilltop to seabed, rendered on a 4 m grid and computed on a 2 m analysis raster. Traced coastlines are softened with corner-cutting subdivision, then converted to an exact signed distance field and blurred. This rounds corners, removes medial-axis ridges, and lets the water plane meet a sloping surface naturally, so there are no stair-stepped or cut-out shore edges.
- Elevation is broad and deterministic, with no random noise. The low town plateau is about 4 m, North Town is a proper highland at about 13 to 15 m with rolling shoulders, and a tighter local rise places the lighthouse summit at about 28 m. Land heights scale with the elevation control. The waterline and seabed do not.
- The former lighthouse road loops are removed. One centered approach continues directly from North Town's central street to the lighthouse terrace; the west and east perimeter streets now stop at North Town's northern cross street.
- Shore character varies smoothly along the coast: beaches (wide shallow shelves, sand bands, wetter sand at the waterline), firm embankments where roads approach the water or face the port channel, and rocky cliffs on the lighthouse headland. The harbor front and port channel are dredged to deep water.
- Road corridors are graded into level platforms that follow a smoothed longitudinal profile, with feathered shoulders. Building lots, the civic plaza, and the lighthouse summit receive feathered pads. Grading never lifts more than the shallow margin, so coastlines are not swallowed.
- Road surfaces are split at the terrain's 4 m cell edges and triangle diagonals, with welded vertices and a fixed 0.18 m asphalt clearance. The entire road width follows the ground, not just its outer edges. Pavement is reprojected when elevation changes; road thickness is not stretched with the terrain.
- The port is a flat engineered deck: its land, quay aprons, and complete port-road support corridors are unioned into one paved footprint before extrusion. This keeps the perimeter roads and sidewalks fully visible even where their traced centerlines hug the waterfront, while eliminating overlapping internal walls and top-face seams. The same expanded polygon drives terrain masking, road clipping, and visible quay extrusion, so they cannot disagree. The extrusion has a quay top and retaining sides down to the dredged bed; a concrete coping ring and darker tide band follow only the exterior edge.
- Jetties begin at the shoreline and run level just above the water, with posts down to the seabed. Seabed hidden beneath deep water or the port deck is culled to keep the mesh lean.
- Junctions are formed by polygon unions of the existing road footprints, with no circular patches or added roundabouts. Curbs do not cross junction mouths, and centerline paint is trimmed out of intersecting streets.
- Bridges use a continuous interpolated profile, landward crossfall blending, and the same support surface as the joined road network. Parapets stop before the landing junctions. Drive mode samples this shared road surface, including asphalt clearance, instead of a separate nearest-point bridge approximation.
- Scene generation records geometry diagnostics in `root.userData.roadGeometryChecks`: asphalt coverage at F2 (image 788, 164), pavement overlap area, finite vertices, degenerate triangles, minimum centroid clearance, bridge endpoint mismatch, and triangle count. These are numerical diagnostics, not a claim of visual or game-engine validation.
- Buildings use district palettes, textured facades (window grid, warehouse ribs), podium/tower steps downtown, and gable, hip, or flat roofs by district. Heights are scaled per district (downtown 1.0, North Town 0.85, Port 0.8, Beach 0.7) from the traced blockout heights. Each mass is fitted off the street polygon (asphalt, curb, and sidewalk) with a 1.8 m setback, so plots no longer spill onto the roadway. Lot pads match the fitted footprint. Overhanging podiums and eaves were removed.
- The "Land tint" and "Building tint" swatches multiply the existing palette; white leaves it unchanged.

## Source Files

- `src/App.tsx`: workspace UI, project state, persistence, and export controls.
- `src/MapViewport.tsx`: Three.js renderer, cameras, interaction, drive mode, comparison, and export.
- `src/MiniMap.tsx`: location-grid minimap with car indicator and copyable coordinates.
- `src/mapEngine.ts`: terrain, road, bridge, and massing geometry.
- `src/roadSurfaces.ts`: joined road footprints, terrain-aligned tessellation, bridge profiles, and geometry diagnostics.
- `src/mapData.ts`: source-coordinate layout and settings.
- `src/ReferenceMap.tsx`: vector trace preview.
- `src/referenceStorage.ts`: local reference-image storage.

## Verification

The Vite production build has been checked. Pixel-level agreement with the original image, browser interaction, and importing exported files into a game engine require a separate visual/runtime check.
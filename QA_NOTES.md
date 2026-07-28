# QA Notes

## Completed checks

- JavaScript syntax validation passed for every source module with `node --check`.
- Every `getElementById()` reference maps to an element present in `index.html`.
- Every relative JavaScript import resolves to an existing source file.
- The source tree contains 1,624 lines of JavaScript plus the HUD styling and markup.
- A design review caught and corrected initial capital-ship overlap, reversed steering orientation, stale fleet-manifest updates, deterministic-only encounters, and excessive procedural texture allocation.
- The final random mode varies fleet composition, ship placement, environment seed, sector designation, and starting resources.

## Runtime review limitation

A browser-level WebGL screenshot could not be completed in the build container. The container could not establish a usable GPU/WebGL context, and its package/CDN network path was unavailable. The source therefore passed static and structural checks, but it has not been honestly certified through a visual side-by-side comparison with a commercial Homeworld release.

## Recommended desktop acceptance pass

1. Start `./serve.sh` and open the local URL in Chrome, Edge, or Firefox with WebGL2 enabled.
2. Confirm the loading overlay clears and no errors appear in the browser console.
3. Box-select strike craft, issue a right-click move order, and verify formation offsets remain legible.
4. Right-click a hostile and verify beams, shield flashes, hull damage, destruction effects, resources, event log, and fleet manifest all update.
5. Exercise pause, simulation speeds, focus camera, middle-mouse orbit, cinematic mode, and New Sector.
6. Profile frame time and GPU memory at the intended target resolution; lower pixel ratio or bloom strength first on constrained hardware.

/**
 * Venue simulator. URL contract (the landing page links here):
 *
 *   /sim/?preset=<id>&app=<id>&variant=<v>&o.<name>=<value>&transport=local|peer&res=<n>&room=<token>
 *
 * plus `bots`, per-frame app overrides as `fa.<frame>=<app>`, `focus=<frame>`, and
 * `seed`, `debug`, `idle`, `ak` and `pv`, which pass straight through to every frame.
 * `transport=peer` uses the public broker, or with `peer=<wss address>` our own signalling
 * server. A `key` in that address is the shared secret: the sim keeps it in this tab's
 * sessionStorage, gives it to the frames and drops it from its own address.
 */
import { startSim } from "./sim/app";

startSim(document.body);

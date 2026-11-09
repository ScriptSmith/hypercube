/**
 * Standalone admin for the operator's phone or laptop. URL contract (the landing page's
 * configuration panel links here):
 *
 *   /admin/?room=<token>&ak=<key>&pv=<pin verifier>&peer=<public|wss://...>&transport=<peer|local>
 *
 * It joins the room as a console that never becomes the hub, checks the PIN against `pv`
 * locally, then shows the same admin panel that frames show after their unlock gesture.
 * Without a room in the address it shows a form for the room, admin key, PIN and signalling,
 * filled in from what this browser remembers.
 */
import "./admin/admin.css";
import { startAdminPage } from "./admin/page";

startAdminPage(document.body);

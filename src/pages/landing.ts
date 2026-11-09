import "./landing/landing.css";
import { listApps } from "../core/registry";
import { mountLanding } from "./landing/app";

mountLanding(document.body, listApps());

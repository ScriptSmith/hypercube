/**
 * Every chapter, by id. Each chapter's folder default-exports its `ChapterDef`, so a change to
 * one chapter stays inside its own folder.
 */
import type { ChapterDef } from "../chapter";
import type { ChapterId } from "../ids";
import absences from "./absences";
import bragg from "./bragg";
import crystal from "./crystal";
import goniometer from "./goniometer";
import helix from "./helix";
import interference from "./interference";
import inverse from "./inverse";
import mystery from "./mystery";
import patterns from "./patterns";
import spectrum from "./spectrum";
import synthesis from "./synthesis";

export const CHAPTERS: Readonly<Record<ChapterId, ChapterDef>> = {
  spectrum,
  interference,
  crystal,
  bragg,
  goniometer,
  patterns,
  inverse,
  absences,
  synthesis,
  helix,
  mystery,
};

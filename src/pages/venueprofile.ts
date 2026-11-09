/**
 * The operator's venue profile: the `venue` URL value that gives an installation's own display
 * sizes. It is remembered in this browser, apart from any one app's settings, so the landing
 * panel and the simulator put it into every URL they make.
 */
import {
  DEFAULT_VENUE,
  encodeVenue,
  mergeVenue,
  parseVenue,
  type VenueProfile,
} from "../core/venue";

const KEY = "hc:venue";

export interface VenueText {
  /** The profile as the URL carries it: only what differs from the defaults, or empty. */
  text: string;
  profile: VenueProfile;
  /** Entries that were not understood, as written. */
  ignored: string[];
}

/** Pasted text may be a whole `venue=` parameter, and percent-encoded. */
const unwrap = (raw: string): string => {
  const text = raw.replace(/\s+/g, "").replace(/^venue=/i, "");
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** Read a pasted or stored profile into its tidy form. */
export const readVenueText = (raw: string): VenueText => {
  const { patch, ignored } = parseVenue(unwrap(raw));
  const profile = mergeVenue(DEFAULT_VENUE, patch);
  return { text: encodeVenue(profile), profile, ignored };
};

export const loadVenueText = (): string => {
  try {
    return readVenueText(localStorage.getItem(KEY) ?? "").text;
  } catch {
    return "";
  }
};

/** Remember the profile, or forget it when empty. */
export const saveVenueText = (text: string): void => {
  try {
    if (text) localStorage.setItem(KEY, text);
    else localStorage.removeItem(KEY);
  } catch {
    // Private mode or a full quota: the profile then lasts for this page only.
  }
};

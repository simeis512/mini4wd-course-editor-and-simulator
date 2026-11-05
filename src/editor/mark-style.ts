// How the marks for picking joints look in both views (#146).

/** How much of the track's width a joint's bar spans. */
export const JOINT_REACH = 0.6;
/** Size of the selected joint's mark over an unselected one. */
export const JOINT_SELECTED_SIZE = 1.6;
/**
 * Dark edge round the joint marks, so they stand out on light green
 * masking tape (#146, owner 2026-11-01). Always drawn, tape or not, so a
 * mark looks the same everywhere.
 */
export const MARK_OUTLINE = '#0b1a12';
/** Width of that edge on screen, px, each side. */
export const MARK_OUTLINE_PX = 1.5;

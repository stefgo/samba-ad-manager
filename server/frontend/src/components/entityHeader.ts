import type { ComponentProps } from "react";
import type { EntityHeader } from "@stefgo/react-ui-components";

/**
 * The header of a detail page, whose title is the breadcrumb (`HeaderBreadcrumb`). A trail
 * is longer than the name it replaces, so it has the size of a card's title, not a page's.
 *
 * How the header lays itself out on a narrow screen is the library's: the badges take a
 * line of their own, and a page with a row of buttons rather than one menu trigger says so
 * with `actionsBelow`.
 */
export const ENTITY_HEADER: NonNullable<ComponentProps<typeof EntityHeader>["classNames"]> = {
    title: "text-base font-semibold",
};

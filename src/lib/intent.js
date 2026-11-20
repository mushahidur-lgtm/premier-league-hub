// @ts-check
/**
 * One pending focus request across a page change: the "/" shortcut asks for the search box, and whichever
 * runs last after the navigation (the app's new-page focus, or the lazily loaded search page) honours it
 * instead of focusing the main region.
 */
let searchFocus = false;
export const requestSearchFocus = () => {
  searchFocus = true;
};
export const searchFocusPending = () => searchFocus;
export const clearSearchFocus = () => {
  searchFocus = false;
};

/**
 * Accessibility props for non-interactive status content (banners, cue chips, status chips, persistent labels).
 *
 * While a window is open (view.capturing) these render visually only (amendment A8-01): not an accessibility
 * element, hidden from the accessibility tree, no label, never a live region, never a focus target. Their
 * announcement is deferred: once capture closes they become ordinary labelled elements (and anything that
 * must be spoken arrives through view.announcement, which the store holds back until reveal for hidden attempts).
 */
export function statusA11y(capturing: boolean, label: string) {
  if (capturing) {
    return {
      accessible: false,
      'aria-hidden': true,
      importantForAccessibility: 'no-hide-descendants',
    } as const;
  }
  return { accessible: true, 'aria-label': label } as const;
}

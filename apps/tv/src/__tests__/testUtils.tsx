import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import type { ActionId, TvView } from '@atr/session-core';
import { ScreenRouter } from '../screens';

export function renderView(view: TvView, onAction: (id: ActionId) => void = () => undefined) {
  return render(<ScreenRouter view={view} onAction={onAction} />);
}

type Json = ReturnType<ReturnType<typeof render>['toJSON']>;

/** Every string a user or screen reader could get from the rendered tree: text nodes and accessibility labels/hints. */
export function allStrings(tree: Json): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const element = node as { props?: Record<string, unknown>; children?: unknown };
    const props = element.props ?? {};
    for (const key of ['aria-label', 'accessibilityLabel', 'accessibilityHint']) {
      const value = props[key];
      if (typeof value === 'string') out.push(value);
    }
    visit(element.children);
  };
  visit(tree);
  return out;
}

/** Host elements that ask for the preferred TV focus. */
export function preferredFocusHosts(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => typeof node.type === 'string' && node.props.hasTVPreferredFocus === true);
}

/** Host elements that are buttons (role="button"). */
export function buttonHosts(root: ReactTestInstance): ReactTestInstance[] {
  return root.findAll((node) => typeof node.type === 'string' && node.props.role === 'button');
}

type Rendered = ReturnType<typeof render>;

/**
 * One entry per action control, as WE rendered it (the outermost component carrying testID "action-<id>"; for a
 * Pressable that is the component whose props are exactly the ones we passed). Props are read here, not from the
 * host View, because the React Native renderer rewrites aria-* aliases into the legacy accessibility props
 * before they reach the host element.
 */
export function actionControls(screen: Rendered): ReactTestInstance[] {
  const matches = screen.UNSAFE_root.findAll(
    (node) => typeof node.type !== 'string' && typeof node.props.testID === 'string' && node.props.testID.startsWith('action-'),
  );
  const seen = new Set<string>();
  const unique: ReactTestInstance[] = [];
  for (const node of matches) {
    const id = node.props.testID as string;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(node);
  }
  return unique;
}

export function pressableFor(screen: Rendered, id: string): ReactTestInstance {
  const match = actionControls(screen).find((node) => node.props.testID === 'action-' + id);
  if (match === undefined) throw new Error('No control for action ' + id);
  return match;
}

/** Controls that ask for the preferred TV focus. */
export function preferredPressables(screen: Rendered): ReactTestInstance[] {
  return actionControls(screen).filter((node) => node.props.hasTVPreferredFocus === true);
}

/** SVG host elements by tag name (the jest SVG mock renders each primitive as a host element named after its tag). */
export function svgElements(root: ReactTestInstance, tag: string): ReactTestInstance[] {
  return root.findAll((node) => (node.type as unknown) === tag);
}

import { configure } from '@testing-library/react-native';
import { resetKeplerMock } from './mocks/react-native-kepler';
import { resetUiScaleMock } from './mocks/kepler-a11y';

// Queries see elements that are hidden from the accessibility tree (aria-hidden / no-hide-descendants) so tests can
// assert BOTH that an element exists and whether it is exposed to screen readers (via isHiddenFromAccessibility).
configure({ defaultIncludeHiddenElements: true });

beforeEach(() => {
  resetKeplerMock();
  resetUiScaleMock();
});

import { createNavigator } from './views/common.js';
import { createSetupScreen } from './views/setup.js';

const nav = createNavigator(document.getElementById('app'));
nav.push(createSetupScreen(nav));

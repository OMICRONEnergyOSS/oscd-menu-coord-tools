import sharedConfig from '@omicronenergy/oscd-tooling/configs/rollup.config.js';

const [pluginConfig, demoConfig] = sharedConfig;
const entries = [
  'src/oscd-menu-sld-positioner.ts',
  'src/oscd-menu-copy-sldv1-sldpriv.ts',
  'src/oscd-menu-copy-sldpriv-sldv1.ts',
  'src/oscd-menu-copy-sxy-sldpriv.ts',
  'src/oscd-menu-copy-sldpriv-sxy.ts',
  'src/oscd-menu-sld-coords-cleaner.ts',
];

export default [
  ...entries.map(input => ({ ...pluginConfig, input })),
  demoConfig,
];

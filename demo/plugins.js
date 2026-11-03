export const plugins = {
  menu: [
    {
      name: 'File',
      translations: { de: 'Datei' },
      icon: 'folder',
      plugins: [
        {
          name: 'Open',
          translations: { de: 'Öffnen' },
          icon: 'description',
          tagName: 'oscd-menu-open',
        },
        {
          name: 'New File',
          translations: { de: 'Neue Datei' },
          icon: 'note_add',
          tagName: 'oscd-menu-new',
        },
        {
          name: 'Save File',
          translations: { de: 'Datei speichern' },
          icon: 'save',
          requireDoc: true,
          tagName: 'oscd-menu-save',
        },
        {
          name: 'Close File',
          translations: { de: 'Datei schließen' },
          icon: 'close',
          requireDoc: true,
          tagName: 'oscd-menu-file-close',
        },
      ],
    },
    {
      name: 'Auto-position SLD elements',
      translations: {
        de: 'SLD automatisch layouten',
      },
      icon: 'account_tree',
      requireDoc: true,
      tagName: 'oscd-menu-sld-positioner',
    },
    {
      name: 'Copy SLDv1 to SLD Private',
      icon: 'content_copy',
      requireDoc: true,
      tagName: 'oscd-menu-copy-sldv1-sldpriv',
    },
    {
      name: 'Copy SLD Private to SLDv1',
      icon: 'content_copy',
      requireDoc: true,
      tagName: 'oscd-menu-copy-sldpriv-sldv1',
    },
    {
      name: 'SLD Coords cleaner',
      icon: 'delete_sweep',
      requireDoc: true,
      tagName: 'oscd-menu-sld-coords-cleaner',
    },
  ],
  editor: [
    {
      name: 'SLD',
      translations: {
        de: 'SLD',
      },
      icon: 'add_box',
      active: true,
      requireDoc: true,
      tagName: 'oscd-editor-sld',
    },
    {
      name: 'Source Editor',
      translations: { de: 'Source Editor' },
      icon: 'code',
      requireDoc: true,
      tagName: 'oscd-editor-source',
    },
  ],
  background: [],
};

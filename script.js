/* Split-script loader for LuxPDF */
(function () {
    if (window.__luxpdfSplitScriptsLoaded) {
        return;
    }
    window.__luxpdfSplitScriptsLoaded = true;

    const version = '1.4';
    const sources = [
        'scripts/luxpdf-theme.js',
        'scripts/pdf-converter-base.js',
        'scripts/pdf-converter-ui.js',
        'scripts/pdf-converter-workflows.js',
        'scripts/pdf-converter-converters-a.js',
        'scripts/pdf-converter-converters-b.js',
        'scripts/pdf-converter-tools.js',
        'scripts/luxpdf-site-init.js'
    ];

    if (document.readyState === 'loading') {
        document.write(sources.map((src) => '<script src="' + src + '?v=' + version + '"><\/script>').join(''));
        return;
    }

    sources.forEach((src) => {
        const script = document.createElement('script');
        script.src = src + '?v=' + version;
        script.async = false;
        document.head.appendChild(script);
    });
})();

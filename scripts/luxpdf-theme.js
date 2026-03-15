/*
    LuxPDF: A free, open-source, and private PDF web application.
    Copyright (C) 2025 LuxPDF

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with this program. If not, see <https://www.gnu.org/licenses/>.
*/

// Global theme management
const LUX_THEME_STORAGE_KEY = 'luxpdf-theme';
const LUX_THEME_LABELS = {
    default: 'Default',
    gold: 'Gold',
    cyan: 'Cyan',
    emerald: 'Emerald',
    hotpink: 'Hot Pink',
    black: 'Black',
    purple: 'Purple'
};

function isValidTheme(themeName) {
    return Object.prototype.hasOwnProperty.call(LUX_THEME_LABELS, themeName);
}

function getStoredTheme() {
    try {
        const saved = (localStorage.getItem(LUX_THEME_STORAGE_KEY) || '').toLowerCase();
        return isValidTheme(saved) ? saved : 'default';
    } catch (_) {
        return 'default';
    }
}

function persistTheme(themeName) {
    try {
        localStorage.setItem(LUX_THEME_STORAGE_KEY, themeName);
    } catch (_) {
        // noop: localStorage may be blocked
    }
}

function closeThemeMenus() {
    document.querySelectorAll('.theme-switcher.open').forEach((switcher) => {
        switcher.classList.remove('open');
        const toggle = switcher.querySelector('.theme-toggle');
        const menu = switcher.querySelector('.theme-menu');
        if (toggle) toggle.setAttribute('aria-expanded', 'false');
        if (menu) menu.hidden = true;
    });
}

function updateThemeOptionState() {
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'default';
    document.querySelectorAll('.theme-option').forEach((option) => {
        const isActive = option.getAttribute('data-theme') === activeTheme;
        option.classList.toggle('active', isActive);
        option.setAttribute('aria-pressed', String(isActive));
    });
}

function applyTheme(themeName, options = {}) {
    const { persist = true } = options;
    const resolvedTheme = isValidTheme(themeName) ? themeName : 'default';
    document.documentElement.setAttribute('data-theme', resolvedTheme);
    document.documentElement.style.colorScheme = 'dark';
    if (persist) persistTheme(resolvedTheme);
    updateThemeOptionState();
}

function buildThemeSwitcherElement() {
    const switcher = document.createElement('div');
    switcher.className = 'theme-switcher';
    switcher.innerHTML = `
        <button type="button" class="theme-toggle" aria-label="Change Theme" aria-expanded="false">
            <i class="fas fa-palette" aria-hidden="true"></i>
        </button>
        <div class="theme-menu" hidden>
            <button type="button" class="theme-option" data-theme="default"><span class="theme-swatch theme-swatch-default"></span>Default</button>
            <button type="button" class="theme-option" data-theme="gold"><span class="theme-swatch theme-swatch-gold"></span>Gold</button>
            <button type="button" class="theme-option" data-theme="cyan"><span class="theme-swatch theme-swatch-cyan"></span>Cyan</button>
            <button type="button" class="theme-option" data-theme="emerald"><span class="theme-swatch theme-swatch-emerald"></span>Emerald</button>
            <button type="button" class="theme-option" data-theme="hotpink"><span class="theme-swatch theme-swatch-hotpink"></span>Hot Pink</button>
            <button type="button" class="theme-option" data-theme="black"><span class="theme-swatch theme-swatch-black"></span>Black</button>
            <button type="button" class="theme-option" data-theme="purple"><span class="theme-swatch theme-swatch-purple"></span>Purple</button>
        </div>
    `;
    return switcher;
}

function normalizeHeaderNavOrder() {
    const nav = document.querySelector('.header .nav');
    if (!nav) return;

    const navLinks = Array.from(nav.querySelectorAll('a.nav-link'));
    if (!navLinks.length) return;

    const detectKey = (link) => {
        const text = (link.textContent || '').trim().toLowerCase();
        const href = (link.getAttribute('href') || '').trim().toLowerCase();
        if (text.includes('tools') || href.includes('#tools')) return 'tools';
        if (text.includes('about') || href.includes('#about')) return 'about';
        if (text.includes('comparison') || href.includes('#comparison')) return 'comparison';
        if (text.includes('faq') || href.includes('#faq')) return 'faq';
        if (text.includes('blog') || href.includes('blog.html')) return 'blog';
        if (text.includes('support us') || href.includes('support.html')) return 'support';
        return null;
    };

    const linkByKey = {};
    navLinks.forEach((link) => {
        const key = detectKey(link);
        if (key && !linkByKey[key]) linkByKey[key] = link;
    });

    // Only normalize pages that use the tool-style nav set.
    if (!(linkByKey.tools && linkByKey.about && linkByKey.comparison && linkByKey.faq && linkByKey.support)) {
        return;
    }

    const aboutHref = (linkByKey.about.getAttribute('href') || '').trim();
    const anchorPrefix = aboutHref.includes('#') ? aboutHref.split('#')[0] : '';
    const sectionHref = (id) => `${anchorPrefix}#${id}`;

    const supportHref = (linkByKey.support.getAttribute('href') || '').trim();
    const defaultBlogHref = supportHref.startsWith('/') ? '/blog.html' : 'blog.html';

    const ensureLink = (key, label, href) => {
        if (linkByKey[key]) return linkByKey[key];
        const link = document.createElement('a');
        link.className = 'nav-link';
        link.href = href;
        link.textContent = label;
        return link;
    };

    const orderedLinks = [
        ensureLink('tools', 'Tools', sectionHref('tools')),
        ensureLink('about', 'About', sectionHref('about')),
        ensureLink('comparison', 'Comparison', sectionHref('comparison')),
        ensureLink('faq', 'FAQ', sectionHref('faq')),
        ensureLink('blog', 'Blog', defaultBlogHref),
        ensureLink('support', 'Support Us', supportHref || defaultBlogHref.replace('blog', 'support'))
    ];

    navLinks.forEach((link) => link.remove());
    orderedLinks.forEach((link) => nav.appendChild(link));
}

function insertThemeSwitcherInHeaderNav() {
    const nav = document.querySelector('.header .nav');
    if (!nav || nav.querySelector('.theme-switcher')) return;

    const supportLink = Array.from(nav.querySelectorAll('a.nav-link')).find((link) => {
        const href = (link.getAttribute('href') || '').toLowerCase();
        const text = (link.textContent || '').toLowerCase();
        return text.includes('support us') || href.includes('support.html');
    });

    const themeSwitcher = buildThemeSwitcherElement();
    if (supportLink) {
        supportLink.insertAdjacentElement('afterend', themeSwitcher);
    } else {
        nav.appendChild(themeSwitcher);
    }

    updateThemeOptionState();
}

let themeEventsBound = false;
function bindThemeEvents() {
    if (themeEventsBound) return;
    themeEventsBound = true;

    document.addEventListener('click', (event) => {
        const selectedOption = event.target.closest('.theme-option');
        if (selectedOption) {
            const selectedTheme = (selectedOption.getAttribute('data-theme') || '').toLowerCase();
            if (isValidTheme(selectedTheme)) {
                applyTheme(selectedTheme, { persist: true });
            }
            closeThemeMenus();
            return;
        }

        const toggle = event.target.closest('.theme-toggle');
        if (toggle) {
            const switcher = toggle.closest('.theme-switcher');
            if (!switcher) return;
            const shouldOpen = !switcher.classList.contains('open');
            closeThemeMenus();
            if (shouldOpen) {
                switcher.classList.add('open');
                toggle.setAttribute('aria-expanded', 'true');
                const menu = switcher.querySelector('.theme-menu');
                if (menu) menu.hidden = false;
            }
            return;
        }

        if (!event.target.closest('.theme-switcher')) {
            closeThemeMenus();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeThemeMenus();
        }
    });
}

function initializeThemeSystem() {
    applyTheme(getStoredTheme(), { persist: false });
    insertThemeSwitcherInHeaderNav();
    bindThemeEvents();
    updateThemeOptionState();
}

// Apply the saved theme as early as possible.
applyTheme(getStoredTheme(), { persist: false });


function setFAQItemState(item, shouldExpand, instant = false) {
    const question = item.querySelector('.faq-question');
    const answer = item.querySelector('.faq-answer');
    if (!question || !answer) return;

    question.setAttribute('aria-expanded', String(shouldExpand));

    if (shouldExpand) {
        item.classList.add('active');
        const targetHeight = answer.scrollHeight;

        if (instant) {
            answer.style.height = 'auto';
            return;
        }

        const startHeight = answer.offsetHeight;
        answer.style.height = `${startHeight}px`;
        requestAnimationFrame(() => {
            answer.style.height = `${targetHeight}px`;
        });
        return;
    }

    const currentHeight = answer.offsetHeight || answer.scrollHeight;
    answer.style.height = `${currentHeight}px`;

    if (instant) {
        item.classList.remove('active');
        answer.style.height = '0px';
        return;
    }

    // Ensure the browser commits current height before collapsing.
    void answer.offsetHeight;
    item.classList.remove('active');
    answer.style.height = '0px';
}

function initializeFAQAccordion() {
    const faqItems = document.querySelectorAll('.faq-item');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    faqItems.forEach(item => {
        const question = item.querySelector('.faq-question');
        const answer = item.querySelector('.faq-answer');
        if (!question || !answer) return;

        question.setAttribute('role', 'button');
        question.setAttribute('tabindex', '0');

        if (!answer.dataset.faqTransitionBound) {
            answer.dataset.faqTransitionBound = 'true';
            answer.addEventListener('transitionend', (event) => {
                if (event.propertyName !== 'height') return;
                if (item.classList.contains('active')) {
                    answer.style.height = 'auto';
                }
            });
        }

        setFAQItemState(item, item.classList.contains('active'), true);

        // Prevent multiple listeners by checking for a marker
        if (!question.dataset.faqInitialized) {
            question.dataset.faqInitialized = 'true';
            question.addEventListener('click', () => {
                setFAQItemState(item, !item.classList.contains('active'), prefersReducedMotion);
            });
            question.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setFAQItemState(item, !item.classList.contains('active'), prefersReducedMotion);
                }
            });
        }
    });
}

// Initialize Mobile Navigation (universal)
function initializeMobileNav() {
    const headerContainer = document.querySelector('.header .container');
    if (!headerContainer) return; // Safety guard

    // Ensure hamburger markup exists (tool pages may not have it)
    let hamburgerMenu = document.querySelector('.hamburger-menu');
    if (!hamburgerMenu) {
        hamburgerMenu = document.createElement('div');
        hamburgerMenu.className = 'hamburger-menu';
        hamburgerMenu.innerHTML = `
            <div class="hamburger-icon">
                <span></span><span></span><span></span>
            </div>
        `;
        headerContainer.appendChild(hamburgerMenu);
    }

    const hamburgerIcon = hamburgerMenu.querySelector('.hamburger-icon');

    // Build/off-canvas mobile navigation
    const mobileNav = document.createElement('div');
    mobileNav.className = 'mobile-nav';

    // Clone desktop navigation but REMOVE the 'nav' class so it isn't hidden by media-query
    const desktopNav = document.querySelector('.nav');
    if (!desktopNav) return; // no nav, abort
    const navClone = desktopNav.cloneNode(true);
    navClone.classList.add('mobile-nav-links');
    navClone.classList.remove('nav');
    mobileNav.appendChild(navClone);

    // Dark overlay behind menu
    const overlay = document.createElement('div');
    overlay.className = 'mobile-overlay';

    document.body.appendChild(mobileNav);
    document.body.appendChild(overlay);

    // Helper to open / close
    const toggleMobileMenu = () => {
        mobileNav.classList.toggle('active');
        overlay.classList.toggle('active');
        hamburgerIcon.classList.toggle('active');
        document.body.style.overflow = mobileNav.classList.contains('active') ? 'hidden' : '';
    };
    const closeMobileMenu = () => {
        mobileNav.classList.remove('active');
        overlay.classList.remove('active');
        hamburgerIcon.classList.remove('active');
        document.body.style.overflow = '';
    };

    // Wire events
    hamburgerMenu.addEventListener('click', toggleMobileMenu);
    overlay.addEventListener('click', closeMobileMenu);
    // Close when any link (including in cloned menu) is tapped
    mobileNav.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', closeMobileMenu);
    });
}

function initializeHeroAudienceTyping() {
    const typingTarget = document.getElementById('hero-audience-text');
    if (!typingTarget) return;

    const audiences = [
        'Freelancers',
        'Students',
        'Small Businesses',
        'Privacy Enthusasists',
        'Journalists'
    ];

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        typingTarget.textContent = audiences[0];
        return;
    }

    const typeSpeedMs = 95;
    const deleteSpeedMs = 55;
    const fullWordPauseMs = 1200;
    const transitionPauseMs = 250;
    let wordIndex = 0;
    let charIndex = 0;
    let isDeleting = false;

    const tick = () => {
        const currentWord = audiences[wordIndex];

        if (isDeleting) {
            charIndex = Math.max(charIndex - 1, 0);
            typingTarget.textContent = currentWord.slice(0, charIndex);

            if (charIndex === 0) {
                isDeleting = false;
                wordIndex = (wordIndex + 1) % audiences.length;
                setTimeout(tick, transitionPauseMs);
                return;
            }

            setTimeout(tick, deleteSpeedMs);
            return;
        }

        charIndex = Math.min(charIndex + 1, currentWord.length);
        typingTarget.textContent = currentWord.slice(0, charIndex);

        if (charIndex === currentWord.length) {
            isDeleting = true;
            setTimeout(tick, fullWordPauseMs);
            return;
        }

        setTimeout(tick, typeSpeedMs);
    };

    typingTarget.textContent = '';
    setTimeout(tick, 300);
}

// Enable touch-friendly sorting for page thumbnails using SortableJS
if (typeof PDFConverterPro !== 'undefined' && typeof Sortable !== 'undefined') {
    PDFConverterPro.prototype.enableThumbnailSorting = function () {
        const container = document.getElementById('page-thumbnails');
        if (!container) return;

        // Destroy previous instance to avoid duplicates
        if (this.thumbnailSortable && typeof this.thumbnailSortable.destroy === 'function') {
            this.thumbnailSortable.destroy();
        }

        this.thumbnailSortable = Sortable.create(container, {
            animation: 220,
            easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
            draggable: '.page-thumbnail',
            // allow drag from any part of the thumbnail
            delay: 700,              // ~1 second long-press on touch devices
            delayOnTouchOnly: true,
            touchStartThreshold: 3,
            forceFallback: true,     // consistent drag preview
            fallbackOnBody: true,
            fallbackTolerance: 3,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            onEnd: () => {
                this.showNotification('Pages reordered! Click Process to generate the sorted PDF.', 'success');
            }
        });
    };
}

// Initialize the main application logic
document.addEventListener('DOMContentLoaded', function () {
    // Initialize FAQ on all pages
    initializeFAQAccordion();

    // Keep top nav ordering consistent across tool pages
    normalizeHeaderNavOrder();

    // Initialize global theming before cloning mobile nav
    initializeThemeSystem();

    // Initialize mobile navigation
    initializeMobileNav();
    updateThemeOptionState();

    // Check if we are on the main page (index.html) by looking for the tools layout
    const isMainPage = document.querySelector('.tools-grid, .tools-table');

    if (isMainPage) {
        // Main page specific initializations
        window.pdfConverter = new PDFConverterPro();
        console.log('PDF Converter Pro initialized for main page');
        initializeHeroAudienceTyping();

        // Legacy support: make tool cards clickable if present
        document.querySelectorAll('.tool-card').forEach(card => {
            card.addEventListener('click', () => {
                const tool = card.dataset.tool;
                if (tool) {
                    window.location.href = `${tool}.html`;
                }
            });
        });

        // Handle newsletter form submission
        const newsletterForm = document.getElementById('newsletter-form');
        if (newsletterForm) {
            newsletterForm.addEventListener('submit', function (e) {
                e.preventDefault();
                const email = document.getElementById('newsletter-email').value;
                if (email) {
                    window.pdfConverter.showNotification('Thank you for subscribing!', 'success');
                    this.reset();
                } else {
                    window.pdfConverter.showNotification('Please enter a valid email address.', 'error');
                }
            });
        }

        // Smooth scroll for anchor links
        document.querySelectorAll('a[href^="#"]').forEach(anchor => {
            anchor.addEventListener('click', function (e) {
                e.preventDefault();
                const targetId = this.getAttribute('href');
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    targetElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start'
                    });
                }
            });
        });
    }
    // Note: Tool-specific pages have their own initialization script in their respective HTML files,
    // which creates an instance of PDFConverterPro and calls setupToolSpecificPage().
});

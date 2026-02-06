/* ============================================
   La Mirada Creativa - Main JavaScript
   ============================================ */

// ============================================
// Page Loader - Hide on DOMContentLoaded (faster than load)
// ============================================
document.addEventListener('DOMContentLoaded', function() {
  const pageLoader = document.getElementById('pageLoader');
  if (pageLoader) {
    // Small delay to ensure styles are applied
    setTimeout(() => {
      pageLoader.classList.add('hidden');
      // Remove from DOM after transition
      setTimeout(() => {
        pageLoader.remove();
      }, 300);
    }, 100);
  }
});

document.addEventListener('DOMContentLoaded', function() {

  // ============================================
  // Countdown Timer - Shows next Sunday date
  // ============================================
  const countdownEl = document.getElementById('countdownTimer');

  if (countdownEl) {
    const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

    function getNextSunday() {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
      const nextSunday = new Date(now);
      nextSunday.setDate(nextSunday.getDate() + daysUntilSunday);
      return nextSunday;
    }

    const nextSunday = getNextSunday();
    const dayNumber = nextSunday.getDate();
    const monthName = meses[nextSunday.getMonth()];
    countdownEl.textContent = dayNumber + ' de ' + monthName;
  }

  // ============================================
  // Accordion functionality
  // ============================================
  const accordionHeaders = document.querySelectorAll('.accordion-header');
  
  accordionHeaders.forEach(button => {
    button.addEventListener('click', () => {
      const item = button.parentElement;
      const isActive = item.classList.contains('active');
      
      // Close all items
      document.querySelectorAll('.accordion-item').forEach(i => {
        i.classList.remove('active');
      });
      
      // Open clicked item if it wasn't active
      if (!isActive) {
        item.classList.add('active');
      }
    });
  });
  
  // ============================================
  // Mobile menu functionality
  // ============================================
  const menuToggle = document.getElementById('menuToggle');
  const mobileNav = document.getElementById('mobileNav');
  const mobileNavClose = document.getElementById('mobileNavClose');
  const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
  
  function openMobileNav() {
    mobileNav.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
  
  function closeMobileNav() {
    mobileNav.classList.remove('active');
    document.body.style.overflow = '';
  }
  
  if (menuToggle) {
    menuToggle.addEventListener('click', openMobileNav);
  }
  
  if (mobileNavClose) {
    mobileNavClose.addEventListener('click', closeMobileNav);
  }
  
  mobileNavLinks.forEach(link => {
    link.addEventListener('click', closeMobileNav);
  });
  
  // ============================================
  // Card Deck - Swipe functionality
  // ============================================
  class CardDeck {
    constructor(container) {
      this.container = container;
      this.cards = Array.from(container.querySelectorAll('.card, .block-card'));
      this.currentIndex = 0;
      this.totalCards = this.cards.length;
      this.startX = 0;
      this.startY = 0;
      this.currentX = 0;
      this.isDragging = false;
      this.threshold = 50;
      this.autoPlayInterval = null;
      this.isAutoPlaying = true;
      
      this.init();
    }
    
    init() {
      // Stop CSS animations
      this.cards.forEach(card => {
        card.style.animation = 'none';
      });
      
      // Set initial positions
      this.updatePositions();
      
      // Start auto-play
      this.startAutoPlay();
      
      // Touch events
      this.container.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
      this.container.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: false });
      this.container.addEventListener('touchend', (e) => this.handleTouchEnd(e));
      
      // Mouse events for testing on desktop
      this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
      this.container.addEventListener('mousemove', (e) => this.handleMouseMove(e));
      this.container.addEventListener('mouseup', (e) => this.handleMouseUp(e));
      this.container.addEventListener('mouseleave', (e) => this.handleMouseUp(e));
    }
    
    startAutoPlay() {
      this.autoPlayInterval = setInterval(() => {
        if (this.isAutoPlaying) {
          this.next();
        }
      }, 1500);
    }
    
    stopAutoPlay() {
      this.isAutoPlaying = false;
      if (this.autoPlayInterval) {
        clearInterval(this.autoPlayInterval);
        this.autoPlayInterval = null;
      }
    }
    
    getCurrentCard() {
      return this.cards.find((card, index) => {
        const position = (index - this.currentIndex + this.totalCards) % this.totalCards;
        return position === 0;
      });
    }
    
    updatePositions(dragOffset = 0) {
      this.cards.forEach((card, index) => {
        const position = (index - this.currentIndex + this.totalCards) % this.totalCards;
        const offset = position * 8;
        const rotation = position * 2;
        const zIndex = this.totalCards - position;
        
        // Apply drag offset only to the top card
        if (position === 0 && dragOffset !== 0) {
          const dragRotation = dragOffset * 0.05;
          card.style.transform = `translateY(${offset}px) translateX(${offset + dragOffset}px) rotate(${rotation + dragRotation}deg)`;
          card.style.transition = 'none';
        } else {
          card.style.transform = `translateY(${offset}px) translateX(${offset}px) rotate(${rotation}deg)`;
          card.style.transition = 'transform 0.4s ease';
        }
        
        card.style.zIndex = zIndex;
        card.style.filter = 'none';
      });
    }
    
    next() {
      this.currentIndex = (this.currentIndex + 1) % this.totalCards;
      this.updatePositions();
    }
    
    prev() {
      this.currentIndex = (this.currentIndex - 1 + this.totalCards) % this.totalCards;
      this.updatePositions();
    }
    
    handleTouchStart(e) {
      this.stopAutoPlay();
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
      this.currentX = 0;
      this.isDragging = true;
    }
    
    handleTouchMove(e) {
      if (!this.isDragging) return;
      const diffX = e.touches[0].clientX - this.startX;
      const diffY = e.touches[0].clientY - this.startY;
      
      // Prevent vertical scroll if horizontal swipe
      if (Math.abs(diffX) > Math.abs(diffY)) {
        e.preventDefault();
        this.currentX = diffX;
        this.updatePositions(diffX);
      }
    }
    
    handleTouchEnd(e) {
      if (!this.isDragging) return;
      this.isDragging = false;
      
      const endX = e.changedTouches[0].clientX;
      const diffX = endX - this.startX;
      
      if (Math.abs(diffX) > this.threshold) {
        this.next();
      } else {
        // Snap back
        this.updatePositions();
      }
    }
    
    handleMouseDown(e) {
      this.stopAutoPlay();
      this.startX = e.clientX;
      this.currentX = 0;
      this.isDragging = true;
      this.container.style.cursor = 'grabbing';
    }
    
    handleMouseMove(e) {
      if (!this.isDragging) return;
      const diffX = e.clientX - this.startX;
      this.currentX = diffX;
      this.updatePositions(diffX);
    }
    
    handleMouseUp(e) {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.container.style.cursor = 'grab';
      
      const diffX = e.clientX - this.startX;
      
      if (Math.abs(diffX) > this.threshold) {
        this.next();
      } else {
        // Snap back
        this.updatePositions();
      }
    }
  }
  
  // Initialize card decks (exclude ones inside modals)
  document.querySelectorAll('.card-deck, .blocks-deck').forEach(deck => {
    // Skip decks inside modals - they'll be initialized when modal opens
    if (!deck.closest('.modal')) {
      new CardDeck(deck);
    }
  });
  
  // ============================================
  // Stripe Embedded Checkout
  // ============================================
  const checkoutModal = document.getElementById('checkoutModal');
  const checkoutClose = document.getElementById('checkoutClose');
  const checkoutContainer = document.getElementById('checkout-container');
  const checkoutButtons = document.querySelectorAll('.btn-checkout');
  
  let stripe = null;
  let checkoutInstance = null;
  
  async function initCheckout() {
    if (!stripe) {
      stripe = Stripe('pk_live_51SloOzROPcCIICCTXoAHSYEv1n4McmijkNODqcNKRIQfTqYoe9qfYMQHLaInoQhPOnW4XCciQMfdKiJ9vFDmDPgV00jKTBhoxw');
    }
    
    try {
      // Get UTM data from localStorage
      let utmData = {};
      try {
        const stored = localStorage.getItem('lmc_utm_data');
        if (stored) utmData = JSON.parse(stored);
      } catch(e) {}

      // Get Amplitude device_id for server-side event linking
      // Priority: get directly from Amplitude (most reliable), fallback to localStorage
      let amplitudeDeviceId = null;
      try {
        if (window.amplitude && typeof amplitude.getDeviceId === 'function') {
          amplitudeDeviceId = amplitude.getDeviceId();
        }
        if (!amplitudeDeviceId) {
          amplitudeDeviceId = localStorage.getItem('lmc_amplitude_device_id');
        }
      } catch(e) {}

      // Create checkout session with UTM data and device_id
      const response = await fetch('/.netlify/functions/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ utm: utmData, amplitude_device_id: amplitudeDeviceId })
      });
      
      if (!response.ok) {
        throw new Error('Error creating checkout session');
      }
      
      const { clientSecret } = await response.json();
      
      // Mount embedded checkout
      checkoutInstance = await stripe.initEmbeddedCheckout({
        clientSecret
      });
      
      checkoutContainer.innerHTML = '';
      checkoutInstance.mount('#checkout-container');
      
    } catch (error) {
      console.error('Checkout error:', error);
      checkoutContainer.innerHTML = `
        <div class="checkout-loading">
          <span class="material-symbols-sharp" style="font-size: 48px; color: #e53935;">error</span>
          <span>Error al cargar el checkout</span>
          <button class="btn btn--secondary" onclick="window.location.reload()">Reintentar</button>
        </div>
      `;
    }
  }
  
  function openCheckoutModal() {
    checkoutModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    
    // Reset container
    checkoutContainer.innerHTML = `
      <div class="checkout-loading">
        <div class="checkout-loading-spinner"></div>
        <span>Cargando checkout...</span>
      </div>
    `;
    
    initCheckout();
  }
  
  function closeCheckoutModal() {
    checkoutModal.classList.remove('active');
    document.body.style.overflow = '';
    
    // Destroy checkout instance
    if (checkoutInstance) {
      checkoutInstance.destroy();
      checkoutInstance = null;
    }
  }
  
  // Event listeners
  checkoutButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Close mobile nav if open
      if (mobileNav && mobileNav.classList.contains('active')) {
        closeMobileNav();
      }
      
      // Get price dynamically from the page
      const priceElement = document.querySelector('.price-current');
      const priceText = priceElement ? priceElement.textContent : '24 €';
      const price = parseFloat(priceText.replace(/[^\d.,]/g, '').replace(',', '.')) || 24;
      
      // Save price for purchase tracking on success page
      try { localStorage.setItem('checkout_price', price); } catch(e) {}
      
      // Track begin_checkout event in Google Analytics
      if (typeof gtag !== 'undefined') {
        gtag('event', 'begin_checkout', {
          currency: 'EUR',
          value: price,
          items: [{
            item_id: 'la_mirada_creativa',
            item_name: 'La Mirada Creativa',
            price: price,
            quantity: 1
          }]
        });
      }
      
      // Track InitiateCheckout event in Facebook Pixel
      if (typeof fbq !== 'undefined') {
        fbq('track', 'InitiateCheckout', {
          value: price,
          currency: 'EUR',
          content_ids: ['la_mirada_creativa'],
          content_type: 'product'
        });
      }
      
      openCheckoutModal();
    });
  });
  
  if (checkoutClose) {
    checkoutClose.addEventListener('click', closeCheckoutModal);
  }
  
  if (checkoutModal) {
    checkoutModal.addEventListener('click', (e) => {
      if (e.target === checkoutModal) {
        closeCheckoutModal();
      }
    });
  }
  
  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && checkoutModal.classList.contains('active')) {
      closeCheckoutModal();
    }
  });
  
  // ============================================
  // Modal Demo Bloques
  // ============================================
  const btnVerDemo = document.getElementById('btnVerDemo');
  const modalBloques = document.getElementById('modalBloques');
  const modalBloquesClose = document.getElementById('modalBloquesClose');
  const modalBloquesBackdrop = modalBloques ? modalBloques.querySelector('.modal-backdrop') : null;
  let blocksDeckInstance = null;
  
  function openModalBloques() {
    if (modalBloques) {
      modalBloques.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      // Initialize the blocks deck if not already done
      const blocksDeck = document.getElementById('blocksDeckDemo');
      if (blocksDeck && !blocksDeckInstance) {
        blocksDeckInstance = new CardDeck(blocksDeck);
      }
    }
  }
  
  function closeModalBloques() {
    if (modalBloques) {
      modalBloques.classList.remove('active');
      document.body.style.overflow = '';
    }
  }
  
  if (btnVerDemo) {
    btnVerDemo.addEventListener('click', openModalBloques);
  }
  
  if (modalBloquesClose) {
    modalBloquesClose.addEventListener('click', closeModalBloques);
  }
  
  if (modalBloquesBackdrop) {
    modalBloquesBackdrop.addEventListener('click', closeModalBloques);
  }
  
  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalBloques && modalBloques.classList.contains('active')) {
      closeModalBloques();
    }
  });
  
  // ============================================
  // Testimonials Carousel Navigation
  // ============================================
  const testimonialsCarousel = document.getElementById('testimonialsCarousel');
  const prevBtn = document.querySelector('.testimonials-nav--prev');
  const nextBtn = document.querySelector('.testimonials-nav--next');
  
  if (testimonialsCarousel && prevBtn && nextBtn) {
    const cardWidth = 280 + 24; // card width + gap
    
    prevBtn.addEventListener('click', () => {
      testimonialsCarousel.scrollBy({ left: -cardWidth, behavior: 'smooth' });
    });
    
    nextBtn.addEventListener('click', () => {
      testimonialsCarousel.scrollBy({ left: cardWidth, behavior: 'smooth' });
    });
  }
  
  // ============================================
  // Fixed Bottom CTA - Show/Hide on Scroll
  // ============================================
  const fixedCta = document.getElementById('fixedCta');
  
  if (fixedCta) {
    const showThreshold = 400; // Show after scrolling 400px
    let lastScrollY = 0;
    let ticking = false;
    
    function updateFixedCta() {
      const scrollY = window.scrollY;
      
      if (scrollY > showThreshold) {
        fixedCta.classList.add('visible');
      } else {
        fixedCta.classList.remove('visible');
      }
      
      lastScrollY = scrollY;
      ticking = false;
    }
    
    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateFixedCta);
        ticking = true;
      }
    }, { passive: true });
    
    // Initial check
    updateFixedCta();
  }

  // ============================================
  // Header Text Color - Adapt to Background
  // ============================================
  const header = document.querySelector('header');
  const darkSections = document.querySelectorAll('.section-dark');

  if (header && darkSections.length > 0) {
    function updateHeaderTextColor() {
      const headerBottom = header.offsetHeight;
      let isOverDark = false;

      darkSections.forEach(section => {
        const rect = section.getBoundingClientRect();
        if (rect.top < headerBottom && rect.bottom > 0) {
          isOverDark = true;
        }
      });

      if (isOverDark) {
        header.classList.add('header--light-text');
      } else {
        header.classList.remove('header--light-text');
      }
    }

    let headerTicking = false;
    window.addEventListener('scroll', () => {
      if (!headerTicking) {
        window.requestAnimationFrame(() => {
          updateHeaderTextColor();
          headerTicking = false;
        });
        headerTicking = true;
      }
    }, { passive: true });

    updateHeaderTextColor();
  }

  // ============================================
  // Social Proof Toast - Simulated Purchases
  // ============================================
  const socialProofToast = document.getElementById('socialProofToast');
  const socialProofClose = document.getElementById('socialProofClose');
  const buyerNameEl = document.getElementById('buyerName');
  const buyerCityEl = document.getElementById('buyerCity');

  if (socialProofToast && buyerNameEl && buyerCityEl) {
    const names = [
      'María G.', 'Carlos R.', 'Laura M.', 'Pablo S.', 'Ana L.',
      'Jorge P.', 'Elena V.', 'David F.', 'Marta C.', 'Sergio H.',
      'Carmen B.', 'Andrés T.', 'Lucía N.', 'Miguel A.', 'Sara D.'
    ];

    const cities = [
      'Madrid', 'Barcelona', 'Valencia', 'Sevilla', 'Bilbao',
      'Málaga', 'Zaragoza', 'Alicante', 'Granada', 'San Sebastián',
      'Palma', 'Las Palmas', 'Murcia', 'Santander', 'Valladolid'
    ];

    let hasScrolled = false;
    let toastTimeout = null;

    window.addEventListener('scroll', () => {
      if (window.scrollY > 200) {
        hasScrolled = true;
      }
    }, { passive: true });

    function getRandomItem(array) {
      return array[Math.floor(Math.random() * array.length)];
    }

    function getRandomInterval() {
      return Math.floor(Math.random() * 20000) + 25000;
    }

    function hideToast() {
      if (toastTimeout) {
        clearTimeout(toastTimeout);
        toastTimeout = null;
      }
      socialProofToast.classList.remove('visible');
    }

    function showToast() {
      if (checkoutModal && checkoutModal.classList.contains('active')) {
        scheduleNextToast();
        return;
      }

      if (!hasScrolled) {
        scheduleNextToast();
        return;
      }

      buyerNameEl.textContent = getRandomItem(names);
      buyerCityEl.textContent = getRandomItem(cities);

      socialProofToast.classList.add('visible');

      toastTimeout = setTimeout(() => {
        hideToast();
        scheduleNextToast();
      }, 4000);
    }

    function scheduleNextToast() {
      setTimeout(showToast, getRandomInterval());
    }

    // Close button
    if (socialProofClose) {
      socialProofClose.addEventListener('click', (e) => {
        e.stopPropagation();
        hideToast();
        scheduleNextToast();
      });
    }

    setTimeout(() => {
      scheduleNextToast();
    }, 10000);
  }
  
});

/* ============================================
   La Mirada Creativa - Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', function() {
  
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
  
  // Initialize card decks
  document.querySelectorAll('.card-deck, .blocks-deck').forEach(deck => {
    new CardDeck(deck);
  });
  
});

(() => {
  const ROOT_SELECTOR = '[data-delivery-estimate]';
  const RANGE_SELECTOR = '[data-delivery-date-range]';
  const TIME_ZONE = 'America/New_York';
  const EARLIEST_BUSINESS_DAYS = 10;
  const LATEST_BUSINESS_DAYS = 17;

  const nyDateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });

  const shortMonthFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
  });

  const longMonthFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
  });

  const getTodayInNewYork = () => {
    const parts = nyDateFormatter.formatToParts(new Date());
    const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);

    return new Date(Date.UTC(read('year'), read('month') - 1, read('day'), 12));
  };

  const addBusinessDays = (date, businessDays) => {
    const result = new Date(date.getTime());
    let daysAdded = 0;

    while (daysAdded < businessDays) {
      result.setUTCDate(result.getUTCDate() + 1);
      const weekday = result.getUTCDay();

      if (weekday !== 0 && weekday !== 6) {
        daysAdded += 1;
      }
    }

    return result;
  };

  const formatShortDate = (date, includeYear = false) => {
    const month = shortMonthFormatter.format(date);
    const day = date.getUTCDate();

    if (includeYear) {
      return `${month} ${day}, ${date.getUTCFullYear()}`;
    }

    return `${month} ${day}`;
  };

  const formatLongDate = (date, includeYear = false) => {
    const month = longMonthFormatter.format(date);
    const day = date.getUTCDate();

    if (includeYear) {
      return `${month} ${day}, ${date.getUTCFullYear()}`;
    }

    return `${month} ${day}`;
  };

  const formatDateRange = (earliestDate, latestDate) => {
    const sameYear = earliestDate.getUTCFullYear() === latestDate.getUTCFullYear();
    const sameMonth = sameYear && earliestDate.getUTCMonth() === latestDate.getUTCMonth();

    if (sameMonth) {
      return `${shortMonthFormatter.format(earliestDate)} ${earliestDate.getUTCDate()}\u2013${latestDate.getUTCDate()}`;
    }

    if (sameYear) {
      return `${formatShortDate(earliestDate)} \u2013 ${formatShortDate(latestDate)}`;
    }

    return `${formatShortDate(earliestDate, true)} \u2013 ${formatShortDate(latestDate, true)}`;
  };

  const formatAriaLabel = (earliestDate, latestDate) => {
    const sameYear = earliestDate.getUTCFullYear() === latestDate.getUTCFullYear();

    return `Estimated delivery between ${formatLongDate(earliestDate, !sameYear)} and ${formatLongDate(
      latestDate,
      !sameYear
    )}`;
  };

  const updateEstimate = (root) => {
    const rangeElement = root.querySelector(RANGE_SELECTOR);
    if (!rangeElement) return;

    const baseDate = getTodayInNewYork();
    const earliestDate = addBusinessDays(baseDate, EARLIEST_BUSINESS_DAYS);
    const latestDate = addBusinessDays(baseDate, LATEST_BUSINESS_DAYS);

    rangeElement.textContent = formatDateRange(earliestDate, latestDate);
    root.setAttribute('aria-label', formatAriaLabel(earliestDate, latestDate));
  };

  const updateAll = (scope = document) => {
    const roots =
      scope instanceof Element && scope.matches(ROOT_SELECTOR)
        ? [scope]
        : Array.from(scope.querySelectorAll ? scope.querySelectorAll(ROOT_SELECTOR) : []);

    roots.forEach(updateEstimate);
  };

  const queueUpdate = (() => {
    let scheduled = false;

    return (scope = document) => {
      if (scheduled) return;

      scheduled = true;
      window.requestAnimationFrame(() => {
        scheduled = false;
        updateAll(scope);
      });
    };
  })();

  const observeDynamicRenders = () => {
    if (!document.body || document.body.dataset.deliveryEstimateObserved === 'true') return;

    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(ROOT_SELECTOR) || node.querySelector(ROOT_SELECTOR)) {
            shouldUpdate = true;
            break;
          }
        }

        if (shouldUpdate) break;
      }

      if (shouldUpdate) queueUpdate(document);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.body.dataset.deliveryEstimateObserved = 'true';
  };

  const initializeDeliveryEstimates = (scope = document) => {
    updateAll(scope);
    observeDynamicRenders();
  };

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        initializeDeliveryEstimates(document);
      },
      { once: true }
    );
  } else {
    initializeDeliveryEstimates(document);
  }

  document.addEventListener('shopify:section:load', (event) => {
    initializeDeliveryEstimates(event.target);
  });

  document.addEventListener('shopify:section:reorder', () => {
    queueUpdate(document);
  });
})();

# PROJECT_RULES.md — Bedding Store Design Rules

Áp dụng riêng cho project bedding hiện tại. Khi đổi project, chỉ thay file này; giữ CORE_RULES.md.

## 1. Brand direction
Phong cách:
- Scandinavian Luxury
- Minimal
- Cozy
- Warm
- Premium
- Modern

Cảm giác cần tạo:
- Sạch, thoáng, mềm mại, tự nhiên.
- Cao cấp nhưng thân thiện.
- Tập trung vào comfort, sleep quality, bedding texture.
- Không rối, không quá nhiều màu, không hiệu ứng mạnh, không shadow nặng.

## 2. Design tokens
Ưu tiên CSS variables/theme settings. Không hard-code lặp lại.

```css
:root {
  --color-bg-main: #FAF8F5;
  --color-bg-soft: #F5F1EA;
  --color-border: #E8E2DB;
  --color-text-main: #3E332D;
  --color-text-muted: #6F625A;
  --color-accent: #B87A5A;
  --color-accent-hover: #A9684C;
  --color-success: #4F7C59;

  --font-heading: 'Playfair Display', serif;
  --font-body: 'Inter', system-ui, sans-serif;

  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 18px;

  --shadow-soft: 0 8px 24px rgb(62 51 45 / 0.08);
  --space-section-desktop: clamp(80px, 8vw, 120px);
  --space-section-mobile: clamp(48px, 12vw, 72px);
}
```

## 3. Typography
- Heading: Playfair Display hoặc Cormorant Garamond.
- Body/UI: Inter, Manrope hoặc Plus Jakarta Sans.
- Desktop: Hero 56–64px, H1 48px, H2 36–40px, H3 24–28px, Body 16px, Small 14px.
- Mobile: Hero 34–40px, H1 32px, H2 26–28px, Body 16px.
- Heading hierarchy phải đúng SEO; không dùng heading chỉ để đổi size.
- Tránh chữ quá mảnh/nhạt trên nền cream/beige.

## 4. Layout and spacing
- Nhiều whitespace, content thoáng, không nhồi section.
- Section desktop: 80–120px; mobile: 48–72px.
- Container tối đa khoảng 1440px; text line-length vừa phải.
- Product/category image ưu tiên 1:1 hoặc 4:5.
- Border mảnh, radius mềm 8–18px.
- Shadow rất nhẹ hoặc không shadow.
- Tránh glassmorphism nặng, gradient gắt, border dày.

## 5. Imagery
Ảnh nên:
- Natural light, warm neutral bedroom.
- Linen/cotton texture rõ.
- Màu white/cream/beige/brown nhẹ.
- Ít đạo cụ, sạch, cao cấp.
- Lifestyle + product texture.

Tránh:
- Ảnh tối, quá saturated, background lộn xộn, mockup rẻ tiền.
- Overlay quá trắng làm mất texture chăn ga.
- Dùng ảnh text embedded nếu text nên là HTML.

Tên file SEO:
- lowercase, dấu `-`, không dấu tiếng Việt.
- Ví dụ: `premium-bedding-hero-banner.webp`, `luxury-comforter-bedroom.webp`.

Alt text:
- Tự nhiên, mô tả ảnh; không keyword stuffing.
- Ảnh trang trí dùng alt rỗng.

## 6. Components
Button:
- Primary: accent hoặc dark brown, text trắng.
- Height khoảng 48px, radius 8–10px, padding 20–28px.
- Hover nhẹ, 200–300ms.
- Secondary nên là outline/text link tinh tế, không cạnh tranh CTA chính.

Product card:
- Ảnh lớn, sạch.
- Tên, giá, sale, rating nếu có dữ liệu thật.
- Không tạo rating/review giả.
- Không viền/shadow nặng.
- Add-to-cart/quick-view không phá trải nghiệm mobile.

Badges/trust:
- Chỉ dùng claim có thật.
- Ví dụ hợp lý: Free Shipping, Easy Returns, Secure Payment, Machine Washable, OEKO-TEX nếu có chứng nhận thật.

Forms:
- Label rõ, lỗi dễ hiểu, CTA rõ.
- Newsletter ngắn, không popup gây phiền.

## 7. Hero rules
Hero nên:
- Large lifestyle image, natural light.
- Text bên trái hoặc trong vùng dễ đọc.
- Overlay nhẹ để text readable nhưng vẫn giữ texture.
- Một CTA chính rõ ràng; CTA phụ nếu cần.
- Responsive art direction: desktop wide, mobile crop riêng nếu cần.
- Không dùng đốm sáng lệch khó kiểm soát; ưu tiên gradient overlay hoặc content panel ổn định.
- Không để text phụ thuộc vào vị trí ảnh quá mong manh.

Hero content gợi ý:
- Eyebrow: Scandinavian Comfort / Premium Bedding
- Heading: Sleep Better Every Night
- Body: Premium blankets, quilts and comforters crafted for everyday comfort.
- CTA: Shop Bedding / Explore Collection

## 8. Homepage structure
Ưu tiên:
1. Hero
2. USP/trust bar
3. Shop by category: Blankets, Quilts, Comforters
4. Featured/best sellers
5. Image with text: comfort/material story
6. Reviews/testimonials nếu có thật
7. Bedroom inspiration/UGC nếu có ảnh thật
8. Newsletter
9. Footer

Không nhồi quá nhiều banner sale hoặc competing CTAs.

## 9. Collection page / PLP
- Collection title là H1.
- Filter/sort rõ, mobile drawer dễ dùng.
- Product grid thoáng, ảnh nhất quán.
- Empty state hữu ích.
- Pagination/load more không phá SEO.
- Breadcrumb/collection description nếu có nên tự nhiên, không keyword stuffing.

## 10. Product page / PDP
Mục tiêu: tăng tin tưởng và chuyển đổi.
- Gallery lớn, responsive, ảnh không méo.
- Product title H1, price rõ, variant rõ.
- CTA nổi bật, sticky buy box nếu phù hợp.
- Shipping/returns/payment/trust info gần CTA.
- Accordion/tabs cho description, material, care, size guide, FAQ.
- Related products hợp lý.
- Reviews/rating chỉ render khi có dữ liệu thật.
- Sold-out/unavailable state rõ, không đánh lừa.
- Personalization/custom fields nếu có phải dễ hiểu và validate rõ.

## 11. Cart / drawer
- Cart drawer nhanh, dễ đóng, keyboard accessible.
- Update/remove quantity rõ.
- Hiển thị subtotal, discount, shipping note đúng dữ liệu Shopify.
- Cross-sell nhẹ, không che CTA checkout.
- Empty cart có CTA quay lại collection.
- Không tính giá giả ở client.

## 12. Header / mobile menu / footer
Header:
- Logo rõ, navigation đơn giản.
- Mega menu nếu dùng phải crawlable và không quá rối.
- Search/account/cart dễ thấy.
- Mobile menu tap target lớn, close rõ, không trap focus sai.

Footer:
- Customer service, policies, about, newsletter, social, payment.
- Copy ngắn, tin cậy.
- Không quá nhiều link gây rối.

## 13. Motion
- Subtle only: fade, slight translate, hover zoom rất nhẹ.
- Duration 200–300ms, easing mềm.
- Không animation bay nhảy, parallax nặng, autoplay gây khó chịu.
- Tôn trọng reduced motion.

## 14. E-commerce ethics and CRO
- CRO bằng clarity, trust, layout tốt; không dùng fake urgency.
- Không fake stock, countdown, rating, review, certification.
- Sale/discount phải lấy từ dữ liệu thật.
- CTA rõ nhưng không spam.
- Luôn tối ưu cho đọc nhanh, mua dễ, tin tưởng cao.

## 15. Definition of done for this project
Một thay đổi UI chỉ xong khi:
- Đúng Scandinavian Luxury + Minimal + Cozy.
- Không làm mất texture ảnh/bedding.
- Desktop/tablet/mobile ổn.
- Không hard-code giá trị đáng ra là token/setting.
- Không phá Theme Editor/schema.
- Không giảm accessibility/performance/SEO.

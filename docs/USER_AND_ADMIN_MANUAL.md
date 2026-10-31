# FurniCraft User & Administrator Manual

This manual provides comprehensive operational guides for the three primary user personas of FurniCraft: **Customers**, **Shop Owners**, and **Platform Administrators**.

---

## 1. Customer User Guide

### 1.1 Browsing Furniture & Furniture Shops
1. Visit the **Landing Page** or navigate to `/shops` to discover verified local woodworking shops.
2. View shop storefronts to inspect their photo galleries, artisan bios, business hours, and customer reviews.
3. Browse a shop's **Design Templates** to load curated starter designs directly into the 3D Studio.

### 1.2 Using the 3D Studio (`/customize-furniture`)
- **Piece Selector**: Switch between available base archetypes (Victorian Chair, Cushion Tub Chair, Rattan Armchair, Patio Chair, Stool).
- **Orbit Navigation**: 
  - *Left Click + Drag*: Orbit / Rotate camera.
  - *Right Click + Drag*: Pan camera.
  - *Scroll Wheel*: Zoom in / out.
- **Parametric Sizing**:
  - Click on any piece part (or select it from the sidebar) to reveal custom slider controls (e.g., *Seat Height*, *Seat Depth*, *Leg Thickness*).
  - Watch the live **3D Measurement Ruler** update in real-time.
- **Finishes & Materials**:
  - Choose between genuine Philippine woods (Narra, Mahogany), cane, synthetic rattan, or upholstery fabrics.
  - Select surface luster (Raw/Oiled, Hand-Rubbed Wax, Satin Polyurethane, Gloss Lacquer).
- **2D Blueprint Inspector**:
  - Toggle the blueprint drawer to view the live orthographic vector shop drawing with dimension callouts in centimetres.

### 1.3 Placing an Order
1. Click **Order This Design** to navigate to `/order-summary`.
2. Select your target shop, attach optional reference images (e.g., room photos), and add special woodworking notes.
3. Submit the order. It will immediately appear in your **Customer Dashboard** (`/protected`).

### 1.4 Managing Quotes, Payments & Reviews
1. **Quote Review**: When the shop quotes a total price and downpayment percentage, review it in your order detail view or chat thread. Click **Accept Quote** or **Decline**.
2. **Direct QR Payment**: Scan the shop's GCash or QR Ph code, transfer the exact downpayment amount, and upload your transaction receipt screenshot.
3. **Production Tracking**: Track the order through `in_production` until the shop marks it `completed`.
4. **Submitting Reviews**: Once completed, leave a 1–5 star rating and written review on the shop's public storefront.

---

## 2. Shop Owner Operational Guide

### 2.1 Applying for a Shop Account
1. From your customer dashboard settings, click **Apply as Shop Owner**.
2. Fill in your business details (Shop Name, Slug, Contact Phone, Furniture Shop Address).
3. Upload official verification documents:
   - **BIR Form 2303 / Certificate of Registration**
   - **Valid Government-Issued ID** (Passport, UMID, Driver's License)
4. Submit for administrator review.

### 2.2 Storefront & Payment Configuration (`/protected/shop`)
Once approved by an admin:
1. Navigate to the **Storefront Profile** tab.
2. Upload your **Shop Logo**, **Cover Banner**, and **Furniture Shop Gallery Photos**.
3. Configure your **Payment Setup**:
   - Upload your official **GCash / QR Ph QR Code Image**.
   - Enter your Bank Name, Account Name, and Account Number.
   *(These details are safely encrypted and only revealed to customers with confirmed orders).*

### 2.3 Publishing Design Templates
1. Open any design in the 3D Studio and click **Save as Template**.
2. Set a title, tag (e.g., "Dining", "Living Room"), estimated price, and publish status.
3. Published templates appear immediately on your public shop storefront.

### 2.4 Quoting & Order Processing
1. Navigate to the **Incoming Orders** tab.
2. Click on a `Needs quote` order. Open the 3D design to review exact dimensions and material requests.
3. Enter the **Total Quoted Price (₱)** and **Downpayment Percentage (%)** (minimum 5%). Click **Submit Quote**.
4. **Verifying Payments**: When the order status turns to `Receipt to check`:
   - Open your mobile banking / GCash app to verify incoming funds.
   - Click **Approve Receipt** to move the order to `In Production`.
   - If the receipt is illegible or incorrect, click **Reject Receipt** and provide a reason for the customer to re-upload.
5. When the furniture is built and delivered, click **Mark as Completed**.

---

## 3. Platform Administrator Guide

### 3.1 Accessing the Admin Queue (`/admin`)
- Administrative access requires `is_admin = true` on your `user_profiles` row.
- Non-admin users attempting to visit `/admin` receive a standard 404 page.

### 3.2 Reviewing Seller Applications
1. Open `/admin` to view the table of **Pending Shop Applications**.
2. Click **Review Application** to view:
   - Applicant Profile & Contact Information.
   - Proposed Shop Name, Slug, and Address.
   - Secure time-limited signed links to BIR registration documents and Government IDs.
3. Verify business legitimacy against local records.
4. Click **Approve Application** to immediately activate the shop storefront and unlock shop owner dashboard capabilities, or click **Reject Application** with an explanatory note.

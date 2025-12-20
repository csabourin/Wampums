# Manual Verification - Equipment Photo Uploads

Use these checks after deploying the equipment photo processing changes:

1. **Successful upload with resizing**
   - Upload a JPEG, PNG, or HEIC image smaller than 3MB to `POST /equipment/:id/photo`.
   - Confirm the stored file path ends in `.webp`, the response `photo_url` loads, and the image is visibly resized (max 640x480).

2. **Oversize input rejection**
   - Attempt to upload an image larger than 3MB.
   - Verify the API returns a 400 response that mentions the maximum size limit and does not update the equipment record.

3. **Backward compatibility**
   - Load an equipment item that already references a legacy photo URL (e.g., `.jpg` or `.png`).
   - Ensure the existing image still renders and is not deleted until a new upload succeeds.

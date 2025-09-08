import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      console.error('Missing Cloudinary environment variables');
      return res.status(500).json({ error: 'Cloudinary not configured. Please add environment variables.' });
    }

    const { imageData, artistName } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Upload to Cloudinary with metadata using tags for better reliability
    const uploadResult = await cloudinary.uploader.upload(imageData, {
      folder: 'portfolio-drawings',
      tags: [`artist:${artistName || 'Anon'}`, `created:${new Date().toISOString()}`],
      context: {
        artist_name: artistName || 'Anon',
        created_at: new Date().toISOString()
      }
    });

    return res.status(200).json({ 
      success: true, 
      url: uploadResult.secure_url,
      public_id: uploadResult.public_id,
      artistName: artistName || 'Anon',
      createdAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error saving drawing:', error);
    return res.status(500).json({ 
      error: 'Failed to save drawing',
      details: error.message 
    });
  }
}

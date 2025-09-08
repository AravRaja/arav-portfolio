import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Check if Cloudinary is configured
    if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
      return res.status(500).json({ error: 'Cloudinary not configured' });
    }

    // Search for drawings in the 'portfolio-drawings' folder
    const searchResult = await cloudinary.search
      .expression('folder:portfolio-drawings')
      .with_field('context')
      .with_field('tags')
      .max_results(50)
      .execute();

    // Extract URLs and metadata from the search results
    const drawings = searchResult.resources.map(resource => {
      // Try to get artist name from tags first, then context, then default
      let artistName = 'Anon';
      if (resource.tags && Array.isArray(resource.tags)) {
        const artistTag = resource.tags.find(tag => tag.startsWith('artist:'));
        if (artistTag) {
          artistName = artistTag.replace('artist:', '');
        }
      }
      if ((!artistName || artistName === 'Anon') && resource.context?.artist_name) {
        artistName = resource.context.artist_name;
      }
      
      // Try to get created date from tags first, then context, then resource
      let createdAt = resource.created_at;
      if (resource.tags && Array.isArray(resource.tags)) {
        const createdTag = resource.tags.find(tag => tag.startsWith('created:'));
        if (createdTag) {
          createdAt = createdTag.replace('created:', '');
        }
      }
      if (!createdAt && resource.context?.created_at) {
        createdAt = resource.context.created_at;
      }
      
      return {
        public_id: resource.public_id,
        url: resource.secure_url,
        artistName,
        createdAt
      };
    });

    // Return all drawings in chronological order (most recent first)
    const selectedDrawings = drawings;

    return res.status(200).json({
      success: true,
      drawings: selectedDrawings,
      total: searchResult.total_count
    });

  } catch (error) {
    console.error('Error fetching drawings:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch drawings',
      details: error.message 
    });
  }
}

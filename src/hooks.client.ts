import type { HandleClientError } from '@sveltejs/kit';

// Handle .html file extensions by stripping them from the URL
export const handleError: HandleClientError = ({ error, event }) => {
  console.error('Error:', error);
  return {
    message: 'An error occurred'
  };
};

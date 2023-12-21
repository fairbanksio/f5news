export const hotnessBGColor = (upvoteCount) => {
  if (upvoteCount >= 100 && upvoteCount < 250) {
    return 'trending';
  } else if (upvoteCount >= 250 && upvoteCount < 500) {
    return 'hot';
  } else if (upvoteCount >= 500) {
    return 'f5oclock';
  } else {
    return false;
  }
}
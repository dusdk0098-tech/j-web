export function workerFieldRequirements(category){
  return {company:!['직영','근로를 제공하지 않는 사람'].includes(category),occupation:category!=='근로를 제공하지 않는 사람'};
}

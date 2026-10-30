export function startWorkerLoads(tasks,onError){
  for(const task of tasks)void Promise.resolve().then(task).catch(onError);
}

export interface EditorRequest {
  sql: string;
  run: boolean;
}

function channel<T>() {
  const listeners = new Set<(value: T) => void>();
  return {
    emit(value: T): boolean {
      listeners.forEach((listener) => listener(value));
      return listeners.size > 0;
    },
    subscribe(listener: (value: T) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const editorRequests = channel<EditorRequest>();

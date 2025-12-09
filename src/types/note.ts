export enum NoteType {
  Text = "text",
  List = "list",
}

export interface ListItem {
  id: string;
  content: string;
  isCompleted: boolean;
}

export interface BaseNote {
  id: string;
  title: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TextNote extends BaseNote {
  type: NoteType.Text;
  content: string;
}

export interface ListNote extends BaseNote {
  type: NoteType.List;
  items: ListItem[];
}

export type Note = TextNote | ListNote;
import { nbMessages } from "./messages/nb";

export type Language = "nb" | "en";

type Primitive = string;

export type Messages = typeof nbMessages;

export type PartialMessages = {
  [K in keyof Messages]?: Messages[K] extends Primitive ? string : PartialMessagesFor<Messages[K]>;
};

type PartialMessagesFor<T> = {
  [K in keyof T]?: T[K] extends Primitive ? string : PartialMessagesFor<T[K]>;
};

type NestedKeys<T> = {
  [K in keyof T & string]: T[K] extends Primitive ? K : `${K}.${NestedKeys<T[K]>}`;
}[keyof T & string];

export type MessageKey = NestedKeys<Messages>;

export type TranslationValues = Record<string, number | string>;

export type Translator = (key: MessageKey, values?: TranslationValues) => string;

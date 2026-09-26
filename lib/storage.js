"use strict";

const KEY_DECLARANT = "declarant";
const KEY_ARTICLES = "articles";

function getDeclarant() {
  return new Promise(resolve => {
    chrome.storage.local.get([KEY_DECLARANT], data => {
      resolve(data[KEY_DECLARANT] || { nomEntreprise: "", nii: "", departement: "" });
    });
  });
}

function saveDeclarant(declarant) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [KEY_DECLARANT]: declarant }, resolve);
  });
}

function getArticles() {
  return new Promise(resolve => {
    chrome.storage.local.get([KEY_ARTICLES], data => {
      resolve(data[KEY_ARTICLES] || {});
    });
  });
}

function saveArticles(articles) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [KEY_ARTICLES]: articles }, resolve);
  });
}

async function upsertArticle(code, article) {
  const articles = await getArticles();
  articles[code] = article;
  await saveArticles(articles);
}

async function deleteArticle(code) {
  const articles = await getArticles();
  delete articles[code];
  await saveArticles(articles);
}

window.Store = {
  getDeclarant,
  saveDeclarant,
  getArticles,
  saveArticles,
  upsertArticle,
  deleteArticle
};

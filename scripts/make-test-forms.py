# Test forms for Paraph: modelled on French administrative forms (cerfa style), all marked as test documents.
import os
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, black, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

OUT = '/home/claude/paraph/samples/formulaires'
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('Hand', '/usr/share/fonts/truetype/google-fonts/ofl/comicrelief/ComicRelief-Regular.ttf'))
W, H = A4
BLUE = HexColor('#1f3c88')
GREY = HexColor('#555555')


# ---------- drawing helpers ----------
def header(c, title, sub, num):
    c.setFillColor(BLUE); c.rect(36, H - 92, 70, 52, fill=1, stroke=0)
    c.setFillColor(white); c.setFont('Helvetica-Bold', 7)
    for i, t in enumerate(['MODÈLE', 'DE TEST', 'PARAPH']): c.drawCentredString(71, H - 58 - i * 9, t)
    c.setFillColor(BLUE); c.setFont('Helvetica-Bold', 13); c.drawCentredString(W / 2 + 20, H - 58, title)
    c.setFont('Helvetica', 9); c.setFillColor(black); c.drawCentredString(W / 2 + 20, H - 72, sub)
    c.setFont('Helvetica-Bold', 8); c.drawRightString(W - 36, H - 50, num)
    c.setFont('Helvetica-Oblique', 7); c.setFillColor(GREY)
    c.drawRightString(W - 36, H - 104, 'Document de test – sans valeur officielle')
    c.setFillColor(black)


def frame(c, x, y, w, h, title):
    """section frame whose title interrupts the top line, like the cerfa forms"""
    c.setStrokeColor(BLUE); c.setLineWidth(1)
    c.setFont('Helvetica-Bold', 10.5)
    tw = c.stringWidth(title, 'Helvetica-Bold', 10.5)
    c.line(x, y, x, y - h); c.line(x, y - h, x + w, y - h); c.line(x + w, y - h, x + w, y)
    c.line(x, y, x + 10, y); c.line(x + 18 + tw, y, x + w, y)
    c.setFillColor(BLUE); c.drawString(x + 14, y - 3.5, title); c.setFillColor(black); c.setStrokeColor(black)


def comb(c, x, y, n, cell=11, groups=None):
    """|_|_|_| boxes; groups = list of sizes for dates like JJ MM AAAA"""
    c.setLineWidth(0.6)
    sizes = groups or [n]
    for g in sizes:
        c.line(x, y, x + g * cell, y)
        for i in range(g + 1): c.line(x + i * cell, y, x + i * cell, y + (5 if 0 < i < g else 8))
        x += g * cell + 6
    return x


def tick(c, x, y, s=8.5):
    c.setLineWidth(0.7); c.rect(x, y, s, s)


def label(c, x, y, t, size=9, bold=False):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size); c.drawString(x, y, t)
    return x + c.stringWidth(t, 'Helvetica-Bold' if bold else 'Helvetica', size)


def caption(c, x, y, t):
    c.setFont('Helvetica', 6.3); c.setFillColor(GREY); c.drawString(x, y, t); c.setFillColor(black)


def uline(c, x1, x2, y):
    c.setLineWidth(0.6); c.line(x1, y, x2, y)


def person_block(c, y, title, with_birth=True):
    """identity block of a cerfa-like form; returns the y below it"""
    frame(c, 36, y, W - 72, 175 if with_birth else 150, title)
    yy = y - 22
    label(c, 46, yy, 'Sexe :'); label(c, 82, yy, 'M'); tick(c, 92, yy - 1); label(c, 110, yy, 'F'); tick(c, 118, yy - 1)
    yy -= 26
    x = label(c, 46, yy, 'Nom de naissance :') + 6; comb(c, x, yy - 2, 24)
    yy -= 22
    x = label(c, 46, yy, "Nom d'usage :") + 6; comb(c, x, yy - 2, 24)
    yy -= 22
    x = label(c, 46, yy, 'Prénom(s) :') + 6; comb(c, x, yy - 2, 24)
    if with_birth:
        yy -= 24
        x = label(c, 46, yy, 'Né(e) le :') + 6; x = comb(c, x, yy - 2, 0, groups=[2, 2, 4])
        caption(c, 92, yy - 10, 'Jour      Mois          Année')
        x = label(c, x + 8, yy, 'à') + 6; uline(c, x, W - 50, yy - 2)
        caption(c, x + 4, yy - 10, 'Commune de naissance')
    yy -= 26
    label(c, 46, yy, 'Adresse :')
    comb(c, 95, yy - 2, 4); uline(c, 145, 220, yy - 2); uline(c, 228, W - 50, yy - 2)
    caption(c, 95, yy - 10, 'N° de voie'); caption(c, 145, yy - 10, 'Type de voie'); caption(c, 228, yy - 10, 'Nom de la voie')
    yy -= 24
    comb(c, 95, yy - 2, 5); uline(c, 160, W - 50, yy - 2)
    caption(c, 95, yy - 10, 'Code postal'); caption(c, 160, yy - 10, 'Commune')
    return y - (175 if with_birth else 150) - 22


def signature_line(c, y, who):
    label(c, 46, y, 'Fait à'); uline(c, 78, 220, y - 2); label(c, 226, y, ', le'); uline(c, 246, 330, y - 2)
    label(c, 380, y, who, 9, True)
    c.setLineWidth(0.6); c.rect(380, y - 70, 175, 60)


# ---------- 1. PDF without fields: vehicle sale declaration (combs, ticks, two persons) ----------
def declaration_cession(path, filled=False):
    c = canvas.Canvas(path, pagesize=A4)
    header(c, "DÉCLARATION DE CESSION D'UN VÉHICULE", "(à remplir par le vendeur et l'acquéreur)", 'N° TEST-01*01')
    y = H - 122
    frame(c, 36, y, W - 72, 92, 'LE VÉHICULE (à remplir par le vendeur)')
    comb(c, 46, y - 30, 11); caption(c, 46, y - 39, "(A) Numéro d'immatriculation")
    comb(c, 190, y - 30, 17); caption(c, 190, y - 39, "(E) Numéro d'identification du véhicule")
    comb(c, 400, y - 30, 0, groups=[2, 2, 4]); caption(c, 400, y - 39, '(B) Date de 1re immatriculation')
    uline(c, 46, 180, y - 62); caption(c, 46, y - 70, '(D.1) Marque'); uline(c, 190, 380, y - 62); caption(c, 190, y - 70, '(D.3) Modèle')
    x = label(c, 400, y - 60, 'Kilométrage :') + 4; uline(c, x, W - 46, y - 62)
    y = person_block(c, y - 112, 'ANCIEN PROPRIÉTAIRE (vendeur)', with_birth=False)
    label(c, 46, y + 6, 'Certifie céder le véhicule ci-dessus le'); x = comb(c, 210, y + 4, 0, groups=[2, 2, 4]); x = label(c, x + 6, y + 6, 'à') + 4; comb(c, x, y + 4, 2); x = label(c, x + 26, y + 6, 'h') + 4; comb(c, x, y + 4, 2)
    y = person_block(c, y - 14, 'NOUVEAU PROPRIÉTAIRE (acquéreur)')
    tick(c, 46, y + 2); label(c, 60, y + 3, "Reconnaît avoir reçu le certificat d'immatriculation barré et signé.", 8.5)
    tick(c, 46, y - 12); label(c, 60, y - 11, 'Reconnaît avoir été informé de la situation administrative du véhicule.', 8.5)
    signature_line(c, y - 40, "Signature de l'acquéreur")
    if filled:
        c.setFont('Hand', 12); c.setFillColor(HexColor('#1b2a6b'))
        c.drawString(48, H - 150, 'A B - 1 2 3 - C D'); c.drawString(193, H - 150, 'V F 1 R 4 5 6 7 8 9 0'); c.drawString(55, H - 182, 'Renault'); c.drawString(195, H - 182, 'Clio')
        c.drawString(150, H - 279, 'D U P O N T'); c.drawString(150, H - 323, 'M A R I E')
    c.showPage(); c.save()


# ---------- 2. PDF without fields: certificate of residence with dotted lines ----------
def attestation_domicile(path):
    c = canvas.Canvas(path, pagesize=A4)
    header(c, 'ATTESTATION SUR L’HONNEUR DE DOMICILE', 'Article de test – formulaire libre', 'N° TEST-02*01')
    y = H - 140
    c.setFont('Helvetica', 11)
    def ln(t, dy=28, bold=False):
        nonlocal y
        c.setFont('Helvetica-Bold' if bold else 'Helvetica', 11); c.drawString(56, y, t); y -= dy
    ln('Je soussigné(e) :', 24, True)
    ln('Madame / Monsieur (nom, prénom) : ' + '.' * 70)
    ln('Né(e) le : ' + '.' * 10 + ' / ' + '.' * 10 + ' / ' + '.' * 16 + '   à : ' + '.' * 48)
    ln('Demeurant : ' + '.' * 92)
    ln('Code postal : ' + '.' * 22 + '   Ville : ' + '.' * 60, 40)
    ln("Atteste sur l'honneur que :", 24, True)
    c.rect(56, y - 2, 9, 9); c.drawString(72, y, 'M.'); c.rect(110, y - 2, 9, 9); c.drawString(126, y, 'Mme'); y -= 28
    ln('Nom : ' + '.' * 100); ln('Prénom : ' + '.' * 96)
    ln('Né(e) le : ' + '.' * 10 + ' / ' + '.' * 10 + ' / ' + '.' * 16 + '   à : ' + '.' * 48)
    ln('réside à mon domicile depuis le : ' + '.' * 50, 40)
    c.setFont('Helvetica-Oblique', 8.5); c.setFillColor(GREY)
    c.drawString(56, y, 'Toute fausse déclaration est passible de sanctions (texte de test).'); c.setFillColor(black); y -= 40
    ln('Fait à : ' + '.' * 50 + '   le : ' + '.' * 25, 34)
    ln('Signature :', 20, True)
    c.rect(56, y - 80, 220, 85)
    c.save()


# ---------- 3. PDF without fields, 2 pages: rental lease (landlord / tenant, underlines) ----------
def bail(path):
    c = canvas.Canvas(path, pagesize=A4)
    header(c, "CONTRAT DE LOCATION – LOCAUX VIDES", 'Modèle de test inspiré du bail type', 'N° TEST-03*01')
    y = H - 130
    for who in ['LE BAILLEUR', 'LE LOCATAIRE']:
        frame(c, 36, y, W - 72, 128, who)
        yy = y - 24
        label(c, 46, yy, 'Civilité :'); tick(c, 92, yy - 1); label(c, 104, yy, 'Madame'); tick(c, 150, yy - 1); label(c, 162, yy, 'Monsieur')
        yy -= 24; x = label(c, 46, yy, 'Nom :') + 6; uline(c, x, 290, yy - 2); x = label(c, 300, yy, 'Prénom :') + 6; uline(c, x, W - 46, yy - 2)
        yy -= 24; x = label(c, 46, yy, 'Date de naissance :') + 6; uline(c, x, 230, yy - 2); x = label(c, 240, yy, 'Lieu de naissance :') + 6; uline(c, x, W - 46, yy - 2)
        yy -= 24; x = label(c, 46, yy, 'Adresse :') + 6; uline(c, x, W - 46, yy - 2)
        yy -= 24; x = label(c, 46, yy, 'Code postal :') + 6; c.rect(x, yy - 5, 60, 16); x = label(c, x + 72, yy, 'Ville :') + 6; uline(c, x, W - 46, yy - 2)
        y -= 150
    frame(c, 36, y, W - 72, 120, 'LE LOGEMENT')
    yy = y - 24; x = label(c, 46, yy, 'Adresse du logement :') + 6; uline(c, x, W - 46, yy - 2)
    yy -= 24; x = label(c, 46, yy, 'Surface habitable (m²) :') + 6; uline(c, x, 220, yy - 2); x = label(c, 240, yy, 'Nombre de pièces :') + 6; uline(c, x, 330, yy - 2)
    yy -= 24; label(c, 46, yy, 'Type :'); tick(c, 82, yy - 1); label(c, 94, yy, 'Appartement'); tick(c, 160, yy - 1); label(c, 172, yy, 'Maison')
    yy -= 24; x = label(c, 46, yy, 'Loyer mensuel (€) :') + 6; uline(c, x, 220, yy - 2); x = label(c, 240, yy, 'Charges (€) :') + 6; uline(c, x, 330, yy - 2)
    c.showPage()
    header(c, "CONTRAT DE LOCATION – LOCAUX VIDES", 'Page 2 – Signatures', 'N° TEST-03*01')
    y = H - 140
    frame(c, 36, y, W - 72, 90, 'DURÉE ET DATE DE PRISE D’EFFET')
    x = label(c, 46, y - 26, 'Date de prise d’effet :') + 6; comb(c, x, y - 28, 0, groups=[2, 2, 4])
    x = label(c, 46, y - 54, 'Durée du contrat (années) :') + 6; uline(c, x, 220, y - 56)
    y -= 120
    for i, who in enumerate(['Signature du bailleur', 'Signature du locataire']):
        x0 = 46 + i * 260
        label(c, x0, y, 'Fait à'); uline(c, x0 + 32, x0 + 150, y - 2); label(c, x0 + 156, y, 'le'); uline(c, x0 + 170, x0 + 240, y - 2)
        label(c, x0, y - 26, who, 9, True); c.rect(x0, y - 110, 220, 75)
    c.save()


# ---------- 4. PDF with real fields: school registration (parent + child, radio, comb fields) ----------
def inscription_champs(path):
    c = canvas.Canvas(path, pagesize=A4); f = c.acroForm
    header(c, 'DEMANDE D’INSCRIPTION SCOLAIRE', 'Formulaire à champs remplissables (test)', 'N° TEST-04*01')
    def tf(name, tip, x, y, w, h=16, maxlen=0, comb_=False):
        kw = dict(name=name, tooltip=tip, x=x, y=y, width=w, height=h, borderColor=HexColor('#8899bb'), fillColor=HexColor('#eef2fb'), textColor=black, fontSize=10, borderWidth=0.6)
        if maxlen: kw['maxlen'] = maxlen
        if comb_: kw['fieldFlags'] = 'comb'
        f.textfield(**kw)
    y = H - 130
    for prefix, title in [('resp', 'RESPONSABLE LÉGAL'), ('enfant', 'ENFANT')]:
        frame(c, 36, y, W - 72, 160 if prefix == 'resp' else 120, title)
        yy = y - 26
        label(c, 46, yy, 'Sexe :'); label(c, 100, yy, 'M'); f.radio(name=f'{prefix}_sexe', value='M', selected=False, x=86, y=yy - 2, size=11, buttonStyle='circle')
        label(c, 136, yy, 'F'); f.radio(name=f'{prefix}_sexe', value='F', selected=False, x=122, y=yy - 2, size=11, buttonStyle='circle')
        yy -= 24; label(c, 46, yy, 'Nom :'); tf(f'{prefix}_nom', 'Nom', 120, yy - 4, 180); label(c, 310, yy, 'Prénom :'); tf(f'{prefix}_prenom', 'Prénom', 360, yy - 4, 180)
        yy -= 24; label(c, 46, yy, 'Né(e) le :'); tf(f'{prefix}_date_naissance', 'Date de naissance (JJMMAAAA)', 120, yy - 4, 110, maxlen=8, comb_=True)
        label(c, 245, yy, 'à :'); tf(f'{prefix}_lieu_naissance', 'Lieu de naissance', 265, yy - 4, 275)
        if prefix == 'resp':
            yy -= 24; label(c, 46, yy, 'Adresse :'); tf('resp_adresse', 'Adresse', 120, yy - 4, 420)
            yy -= 24; label(c, 46, yy, 'Code postal :'); tf('resp_cp', 'Code postal', 120, yy - 4, 70, maxlen=5, comb_=True); label(c, 205, yy, 'Ville :'); tf('resp_ville', 'Ville', 240, yy - 4, 300)
            yy -= 24; label(c, 46, yy, 'Téléphone :'); tf('resp_tel', 'Téléphone', 120, yy - 4, 140); label(c, 275, yy, 'E-mail :'); tf('resp_email', 'Adresse e-mail', 320, yy - 4, 220)
        y -= (182 if prefix == 'resp' else 142)
    frame(c, 36, y, W - 72, 70, 'SCOLARITÉ DEMANDÉE')
    label(c, 46, y - 26, 'Niveau :')
    for i, lv in enumerate(['Maternelle', 'CP', 'CE1', 'CE2', 'CM1', 'CM2']):
        f.checkbox(name=f'niveau_{lv}', x=96 + i * 74, y=y - 29, size=11, buttonStyle='check', borderColor=HexColor('#8899bb'), fillColor=white)
        label(c, 110 + i * 74, y - 26, lv)
    label(c, 46, y - 52, 'Cantine :'); f.checkbox(name='cantine', x=96, y=y - 55, size=11, buttonStyle='check'); label(c, 110, y - 52, 'Oui')
    y -= 96
    label(c, 46, y, 'Fait à :'); tf('fait_a', 'Fait à', 84, y - 4, 160); label(c, 260, y, 'le :'); tf('date_signature', 'Date', 280, y - 4, 100)
    label(c, 400, y + 20, 'Signature :', 9, True); c.rect(400, y - 70, 155, 80)
    c.save()


# ---------- 5. PDF with real fields, 2 pages: proxy (mandant / mandataire) ----------
def procuration_champs(path):
    c = canvas.Canvas(path, pagesize=A4); f = c.acroForm
    def tf(name, tip, x, y, w, maxlen=0, comb_=False):
        kw = dict(name=name, tooltip=tip, x=x, y=y, width=w, height=16, borderColor=HexColor('#8899bb'), fillColor=HexColor('#eef2fb'), fontSize=10, borderWidth=0.6)
        if maxlen: kw['maxlen'] = maxlen
        if comb_: kw['fieldFlags'] = 'comb'
        f.textfield(**kw)
    for page, (pre, title) in enumerate([('mandant', 'VOS INFORMATIONS (le mandant)'), ('mandataire', 'LA PERSONNE QUI VOUS REPRÉSENTE (le mandataire)')]):
        header(c, 'PROCURATION – MODÈLE DE TEST', f'Page {page + 1} / 2', 'N° TEST-05*01')
        y = H - 130
        frame(c, 36, y, W - 72, 190, title)
        yy = y - 26
        label(c, 46, yy, 'Sexe :'); label(c, 100, yy, 'M'); f.radio(name=f'{pre}_sexe', value='M', selected=False, x=86, y=yy - 2, size=11)
        label(c, 136, yy, 'F'); f.radio(name=f'{pre}_sexe', value='F', selected=False, x=122, y=yy - 2, size=11)
        yy -= 26; label(c, 46, yy, 'Nom de naissance :'); tf(f'{pre}_nom_naissance', 'Nom de naissance', 150, yy - 4, 390)
        yy -= 24; label(c, 46, yy, 'Prénom(s) :'); tf(f'{pre}_prenoms', 'Prénoms', 150, yy - 4, 390)
        yy -= 24; label(c, 46, yy, 'Date de naissance :'); tf(f'{pre}_jour', 'Jour de naissance', 150, yy - 4, 26, 2, True); tf(f'{pre}_mois', 'Mois de naissance', 182, yy - 4, 26, 2, True); tf(f'{pre}_annee', 'Année de naissance', 214, yy - 4, 50, 4, True)
        yy -= 24; label(c, 46, yy, 'Commune de naissance :'); tf(f'{pre}_commune_naissance', 'Commune de naissance', 170, yy - 4, 370)
        yy -= 24; label(c, 46, yy, 'Adresse :'); tf(f'{pre}_adresse', 'Adresse', 150, yy - 4, 390)
        yy -= 24; label(c, 46, yy, 'Code postal :'); tf(f'{pre}_cp', 'Code postal', 150, yy - 4, 70, 5, True); label(c, 235, yy, 'Commune :'); tf(f'{pre}_commune', 'Commune', 290, yy - 4, 250)
        if page == 1:
            y -= 220
            frame(c, 36, y, W - 72, 60, 'CADRE RÉSERVÉ À L’ADMINISTRATION')
            label(c, 46, y - 26, 'Reçu le :'); tf('admin_date', 'Date de réception (administration)', 100, y - 30, 100); label(c, 220, y - 26, 'Agent :'); tf('admin_agent', 'Agent (administration)', 260, y - 30, 200)
            y -= 90
            label(c, 46, y, 'Fait à :'); tf('fait_a', 'Fait à', 84, y - 4, 160); label(c, 260, y, 'le :'); tf('date', 'Date', 280, y - 4, 100)
            label(c, 400, y + 20, 'Signature du mandant :', 9, True); c.rect(400, y - 70, 155, 80)
        c.showPage()
    c.save()


# ---------- 6. PDF without fields: expense report (table grid) ----------
def note_de_frais(path):
    c = canvas.Canvas(path, pagesize=A4)
    header(c, 'NOTE DE FRAIS', 'Tableau à compléter (test)', 'N° TEST-06*01')
    y = H - 140
    x = label(c, 46, y, 'Nom :') + 6; uline(c, x, 280, y - 2); x = label(c, 300, y, 'Prénom :') + 6; uline(c, x, W - 46, y - 2)
    y -= 26; x = label(c, 46, y, 'Service :') + 6; uline(c, x, 280, y - 2); x = label(c, 300, y, 'Mois :') + 6; uline(c, x, W - 46, y - 2)
    y -= 34
    cols = [('Date', 70), ('Nature de la dépense', 190), ('Lieu', 110), ('Montant TTC (€)', 100)]
    rows = 10; rh = 22
    c.setLineWidth(0.7); x0 = 46
    c.setFillColor(HexColor('#e8ecf7')); c.rect(x0, y - rh, sum(w for _, w in cols), rh, fill=1, stroke=0); c.setFillColor(black)
    for r in range(rows + 2): c.line(x0, y - r * rh, x0 + sum(w for _, w in cols), y - r * rh)
    x = x0
    for name, w in cols:
        c.line(x, y, x, y - (rows + 1) * rh); c.setFont('Helvetica-Bold', 9); c.drawString(x + 4, y - 15, name); x += w
    c.line(x, y, x, y - (rows + 1) * rh)
    y -= (rows + 1) * rh + 26
    x = label(c, 300, y, 'TOTAL (€) :', 10, True) + 6; c.rect(x, y - 6, 100, 20)
    y -= 50
    signature_line(c, y, 'Visa du responsable')
    c.save()


# ---------- Word documents ----------
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH


def word_base(title, sub):
    d = Document()
    for s in d.sections: s.left_margin = s.right_margin = Cm(2); s.top_margin = Cm(1.6)
    d.styles['Normal'].font.name = 'Calibri'; d.styles['Normal'].font.size = Pt(10.5)
    p = d.add_paragraph(); r = p.add_run('MODÈLE DE TEST PARAPH – sans valeur officielle'); r.font.size = Pt(8); r.italic = True; r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)
    h = d.add_paragraph(); h.alignment = WD_ALIGN_PARAGRAPH.CENTER
    r = h.add_run(title); r.bold = True; r.font.size = Pt(15); r.font.color.rgb = RGBColor(0x1f, 0x3c, 0x88)
    s = d.add_paragraph(sub); s.alignment = WD_ALIGN_PARAGRAPH.CENTER
    return d


def autorisation_parentale(path):
    E = '…'
    d = word_base("AUTORISATION PARENTALE DE SORTIE", "(à remplir par le représentant légal)")
    p = d.add_paragraph(); p.add_run('Je soussigné(e) :').bold = True
    d.add_paragraph('☐ Madame      ☐ Monsieur')
    for l in ['Nom :', E * 60, 'Prénom :', E * 60, 'Demeurant :', E * 60, 'Code postal : ' + E * 8 + '   Ville :', E * 40, 'Téléphone : ' + E * 20]:
        d.add_paragraph(l)
    p = d.add_paragraph(); p.add_run("Agissant en qualité de :").bold = True
    d.add_paragraph('☐ Père      ☐ Mère      ☐ Tuteur / tutrice')
    p = d.add_paragraph(); p.add_run("Autorise l'enfant :").bold = True
    for l in ['Nom : ' + E * 30 + '   Prénom : ' + E * 25, 'Né(e) le : ' + E * 3 + ' / ' + E * 3 + ' / ' + E * 6 + ' à ' + E * 30]:
        d.add_paragraph(l)
    d.add_paragraph('à participer à la sortie organisée le ' + E * 3 + ' / ' + E * 3 + ' / ' + E * 6 + ' à destination de ' + E * 30)
    d.add_paragraph()
    d.add_paragraph('Fait à ' + E * 30 + ', le ' + E * 3 + ' / ' + E * 3 + ' / ' + E * 6)
    p = d.add_paragraph(); p.add_run('Signature du représentant légal :').bold = True
    d.save(path)


def fiche_adhesion(path):
    d = word_base("BULLETIN D'ADHÉSION – ASSOCIATION SPORTIVE", "Saison 2026-2027 (exemple de test)")
    d.add_paragraph().add_run('ADHÉRENT').bold = True
    t = d.add_table(rows=0, cols=4); t.style = 'Table Grid'
    for a, b in [('Nom', 'Prénom'), ('Date de naissance', 'Lieu de naissance'), ('Adresse', ''), ('Code postal', 'Ville'), ('Téléphone', 'E-mail')]:
        r = t.add_row().cells; r[0].text = a; r[2].text = b
        if not b: m = r[1].merge(r[3])
    d.add_paragraph()
    d.add_paragraph().add_run('PERSONNE À PRÉVENIR EN CAS D’URGENCE').bold = True
    t = d.add_table(rows=2, cols=3); t.style = 'Table Grid'
    for i, h in enumerate(['Nom', 'Prénom', 'Téléphone']): t.rows[0].cells[i].text = h
    d.add_paragraph()
    d.add_paragraph().add_run('ACTIVITÉ CHOISIE').bold = True
    d.add_paragraph('☐ Football    ☐ Natation    ☐ Tennis    ☐ Judo')
    d.add_paragraph('Certificat médical fourni :   ☐ Oui    ☐ Non')
    d.add_paragraph()
    d.add_paragraph('Fait à ________________________  le ____ / ____ / ________')
    d.add_paragraph('Signature de l’adhérent :')
    d.save(path)


def attestation_employeur(path):
    d = word_base("ATTESTATION D'EMPLOI", "(à remplir par l'employeur)")
    d.add_paragraph().add_run("L'EMPLOYEUR").bold = True
    for l in ["Raison sociale : ______________________________________________", "Adresse : ___________________________________________________",
              "Code postal : __________   Ville : _____________________________", "N° SIRET : ______________________________"]:
        d.add_paragraph(l)
    d.add_paragraph().add_run("certifie employer :").bold = True
    for l in ["Nom : ___________________________   Prénom : _________________________", "Né(e) le : ____ / ____ / ________   à : ____________________________",
              "Demeurant : _________________________________________________", "Code postal : __________   Ville : _____________________________",
              "En qualité de : ______________________________________________", "Depuis le : ____ / ____ / ________"]:
        d.add_paragraph(l)
    d.add_paragraph('Type de contrat :   ☐ CDI    ☐ CDD    ☐ Intérim    ☐ Apprentissage')
    d.add_paragraph()
    d.add_paragraph('Fait à _________________________, le ____ / ____ / ________')
    d.add_paragraph("Signature et cachet de l'employeur :")
    d.save(path)


if __name__ == '__main__':
    declaration_cession(f'{OUT}/pdf-sans-champs-declaration-cession-vehicule.pdf')
    declaration_cession('/tmp/cession_rempli.pdf', filled=True)
    attestation_domicile(f'{OUT}/pdf-sans-champs-attestation-domicile-pointilles.pdf')
    bail(f'{OUT}/pdf-sans-champs-contrat-location-2-pages.pdf')
    note_de_frais(f'{OUT}/pdf-sans-champs-note-de-frais-tableau.pdf')
    inscription_champs(f'{OUT}/pdf-avec-champs-inscription-scolaire.pdf')
    procuration_champs(f'{OUT}/pdf-avec-champs-procuration-2-pages.pdf')
    autorisation_parentale(f'{OUT}/word-autorisation-parentale.docx')
    fiche_adhesion(f'{OUT}/word-bulletin-adhesion-tableaux.docx')
    attestation_employeur(f'{OUT}/word-attestation-employeur-soulignes.docx')
    print('ok')

# Migrazione porta VPS — Astebook

## Configurazione

Binding gateway `app`: `127.0.0.1:3010:3000` (prima: host 3000). La porta host è fissata nel Compose: eventuali vecchi HOST_PORT/APP_PORT/FRONTEND_PORT non possono ripristinare la pubblicazione precedente. Porte interne, DB, volumi, reti, login e URL HTTPS pubblici restano invariati. La CI verifica il modello Compose con `python3 scripts/check-gateway-port.py`, senza segreti o accesso alla VPS.

## Ordine e passaggi manuali

1. Astebook 3000 → 3010.
2. AgriAvenger 6080 → 3000, solo dopo aver verificato che Astebook abbia liberato 3000.
3. Agenzia Caselli 3080 → 3020.
4. AsteSmart 5000 → 3030.

Prima del merge controllare sulla VPS che la porta destinazione sia libera e che il Compose effettivo non contenga override conflittuali. Il merge su main attiva la pipeline di deploy esistente e la ricreazione dei servizi modificati. Nessun deploy viene lanciato dalla PR. La configurazione Nginx VPS è gestita manualmente dall'operatore: aggiornare l'upstream di questo progetto a `http://127.0.0.1:3010` preservando dominio, TLS, header e autenticazione. Verificare `nginx -t` prima del reload. È possibile un breve 502 tra ricreazione e aggiornamento Nginx.

Verificare health interno, endpoint loopback host, dominio HTTPS, login/logout, dati persistenti e monitor. Le porte gateway devono risultare irraggiungibili dall'IP pubblico anche su IPv6. I client nei container devono continuare a usare endpoint interni o domini HTTPS, non il proprio localhost. I passaggi infrastrutturali (Kuma, Grafana, Portainer, Homepage, Authelia) sono fuori da questa PR e spettano all'operatore.

## Rollback

Registrare SHA/immagini precedenti e salvare configurazioni Nginx/override prima del deploy. Revertire questa PR tramite una nuova PR e ridistribuire la revisione precedente mantenendo identici project name, reti e volumi. Ripristinare il precedente upstream Nginx, validare e ricaricare, quindi ripetere health/login/monitor. Per ripristinare Astebook sulla 3000 dopo la migrazione AgriAvenger, riportare prima AgriAvenger sulla 6080. Mai usare down -v, eliminare volumi o ricreare database.

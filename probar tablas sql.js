function testTransactionTable() {
  NetSuiteOAuthTest.init({
    accountId: '11103874',
    consumerKey: 'c2178cf81c17b74d187db8490b848042a4ed8c0ccb2f987e325723e0574e7b39',
    consumerSecret: '737123dfad89026db69b835eae32b1e8b0e8ae243522097d40b7e1f7ac2438a4',
    token: '033e065a47898ae2695f6f5a9bfb4d19618e59ebc767b5ca0a334bcea7530a12',
    tokenSecret: 'ca633e50878d1d459de4b6e0a60079f792b288a2609e5807f09543146850d15b'
  });

  const sql = `
    SELECT *
    FROM manufacturingoperationtask


  
  
      
  `;

  const data = NetSuiteOAuthTest.querySuiteQL(sql);
  Logger.log('📄 Tipos de transacciones recientes:');
  data.forEach(row => Logger.log(JSON.stringify(row)));
}